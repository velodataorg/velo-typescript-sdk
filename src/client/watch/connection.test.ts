import { afterEach, describe, expect, it, vi } from "vitest";

import { maintainConnection } from "./connection.ts";
import type { WatcherOf, WatchState } from "./watcher.ts";

interface DownEvents {
  readonly close: { readonly code: number };
}

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

  const watcher: WatcherOf<DownEvents> = {
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

/** The gaps between successive reconnect attempts. */
function delays(attemptedAt: readonly number[], from: number): number[] {
  const marks = [from, ...attemptedAt];
  return attemptedAt.map((_, index) => (marks[index + 1] as number) - (marks[index] as number));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("maintainConnection", () => {
  it("uses one backoff sequence from the initial failure onward", async () => {
    vi.useFakeTimers();
    const { watcher, attemptedAt } = downWatcher();
    const start = Date.now();

    /* The delay policy is injected, so the schedule is exact. */
    void maintainConnection(
      watcher,
      { baseDelayMs: 1_000, maxDelayMs: 8_000 },
      {
        schedule: (attempt, retry) => Math.min(retry.maxDelayMs, retry.baseDelayMs * 2 ** attempt),
      },
    );

    await vi.advanceTimersByTimeAsync(60_000);

    expect(attemptedAt[0]).toBe(start);
    expect(delays(attemptedAt, start).slice(1, 7)).toEqual([
      1_000, 2_000, 4_000, 8_000, 8_000, 8_000,
    ]);
    watcher.close();
  });
});
