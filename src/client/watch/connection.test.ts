import { afterEach, describe, expect, it, vi } from "vitest";

import { maintainConnection, STABLE_AFTER_MS } from "./connection.ts";
import type { ResumeSchedule } from "./connection.ts";
import type { WatcherOf, WatchState } from "./watcher.ts";

interface CloseEvents {
  readonly close: { readonly code: number };
}

/* The delay policy without its jitter or its budget, so a schedule is exact. */
const doubling: ResumeSchedule = ({ attempt }, retry) =>
  Math.min(retry.maxDelayMs, retry.baseDelayMs * 2 ** attempt);

/**
 * A watcher that is always down.
 *
 * Every connection attempt fails and ends in a `close`, exactly as the real
 * controller does, so one supervisor drives both the initial attempt and all
 * retries without a socket.
 */
function downWatcher() {
  const closeListeners: (() => void)[] = [];
  const attemptedAt: number[] = [];
  let state: WatchState = "idle";

  const watcher: WatcherOf<CloseEvents> = {
    get state() {
      return state;
    },
    on(_type, listener) {
      closeListeners.push(listener as () => void);
      return this;
    },
    off() {
      return this;
    },
    connect() {
      state = "connecting";
      attemptedAt.push(Date.now());
      return new Promise<void>((_resolve, reject) => {
        queueMicrotask(() => {
          state = "disconnected";
          reject(new Error("still down"));
          for (const listener of closeListeners) listener();
        });
      });
    },
    disconnect() {
      state = "idle";
      for (const listener of closeListeners) listener();
    },
    close() {
      state = "closed";
      for (const listener of closeListeners) listener();
    },
  };

  return { watcher, attemptedAt };
}

/**
 * A watcher that always connects, and drops when told to.
 *
 * Every attempt opens at once and `drop()` ends the connection with a
 * `close`, exactly as the real controller does for a lost socket, so a test
 * decides how long each connection stays up.
 *
 * @param options - `dropOnConnect` loses every connection before the
 * supervisor's continuation runs, as a socket event can.
 */
function upWatcher(options: { readonly dropOnConnect?: boolean } = {}) {
  const closeListeners: (() => void)[] = [];
  const connectedAt: number[] = [];
  const droppedAt: number[] = [];
  let state: WatchState = "idle";

  const emitClose = (): void => {
    for (const listener of closeListeners) listener();
  };
  const drop = (): void => {
    state = "disconnected";
    droppedAt.push(Date.now());
    emitClose();
  };

  const watcher: WatcherOf<CloseEvents> = {
    get state() {
      return state;
    },
    on(_type, listener) {
      closeListeners.push(listener as () => void);
      return this;
    },
    off() {
      return this;
    },
    connect() {
      state = "open";
      connectedAt.push(Date.now());
      if (options.dropOnConnect) drop();
      return Promise.resolve();
    },
    disconnect() {
      state = "idle";
      emitClose();
    },
    close() {
      state = "closed";
      emitClose();
    },
  };

  return { watcher, connectedAt, droppedAt, drop };
}

/** The gaps between successive reconnect attempts. */
function delays(attemptedAt: readonly number[], from: number): number[] {
  const marks = [from, ...attemptedAt];
  return attemptedAt.map((_, index) => (marks[index + 1] as number) - (marks[index] as number));
}

/** How long each reconnection waited after the drop before it. */
function waits(connectedAt: readonly number[], droppedAt: readonly number[]): number[] {
  return connectedAt.slice(1).map((at, index) => at - (droppedAt[index] as number));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("maintainConnection", () => {
  it("uses one backoff sequence from the initial failure onward", async () => {
    vi.useFakeTimers();
    const { watcher, attemptedAt } = downWatcher();
    const start = Date.now();

    void maintainConnection(
      watcher,
      { baseDelayMs: 1_000, maxDelayMs: 8_000 },
      { schedule: doubling },
    );

    await vi.advanceTimersByTimeAsync(60_000);

    expect(attemptedAt[0]).toBe(start);
    expect(delays(attemptedAt, start).slice(1, 7)).toEqual([
      1_000, 2_000, 4_000, 8_000, 8_000, 8_000,
    ]);
    watcher.close();
  });

  it("continues the backoff when each connection drops as soon as it opens", async () => {
    vi.useFakeTimers();
    const { watcher, connectedAt, droppedAt, drop } = upWatcher();
    await maintainConnection(
      watcher,
      { baseDelayMs: 1_000, maxDelayMs: 8_000 },
      { schedule: doubling },
    );

    for (const wait of [1_000, 2_000, 4_000, 8_000, 8_000]) {
      drop();
      await vi.advanceTimersByTimeAsync(wait);
    }

    expect(waits(connectedAt, droppedAt)).toEqual([1_000, 2_000, 4_000, 8_000, 8_000]);
    watcher.close();
  });

  it("continues the backoff when a connection is lost as it settles", async () => {
    vi.useFakeTimers();
    const { watcher, connectedAt, droppedAt } = upWatcher({ dropOnConnect: true });
    void maintainConnection(
      watcher,
      { baseDelayMs: 1_000, maxDelayMs: 8_000 },
      { schedule: doubling },
    );

    await vi.advanceTimersByTimeAsync(1_000 + 2_000 + 4_000);

    expect(waits(connectedAt, droppedAt)).toEqual([1_000, 2_000, 4_000]);
    watcher.close();
  });

  it("starts from the first delay again only once a connection has stayed up", async () => {
    vi.useFakeTimers();
    const { watcher, connectedAt, droppedAt, drop } = upWatcher();
    await maintainConnection(
      watcher,
      { baseDelayMs: 1_000, maxDelayMs: 8_000 },
      { schedule: doubling },
    );

    drop();
    await vi.advanceTimersByTimeAsync(1_000);
    drop();
    /* Up for a millisecond less than stable: the backoff continues. */
    await vi.advanceTimersByTimeAsync(2_000 + STABLE_AFTER_MS - 1);
    drop();
    /* Up for exactly as long as stable: the next drop is a new outage. */
    await vi.advanceTimersByTimeAsync(4_000 + STABLE_AFTER_MS);
    drop();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(waits(connectedAt, droppedAt)).toEqual([1_000, 2_000, 4_000, 1_000]);
    watcher.close();
  });

  it("spends a bounded budget on connections that never stay up", async () => {
    vi.useFakeTimers();
    const { watcher, connectedAt, drop } = upWatcher();
    await maintainConnection(watcher, { retries: 2, baseDelayMs: 0, maxDelayMs: 0 });

    drop();
    await vi.advanceTimersByTimeAsync(0);
    drop();
    await vi.advanceTimersByTimeAsync(0);
    drop();
    await vi.advanceTimersByTimeAsync(60_000);

    /* The first connection plus two redials, then it stays down. */
    expect(connectedAt).toHaveLength(3);
    expect(watcher.state).toBe("disconnected");
    watcher.close();
  });
});
