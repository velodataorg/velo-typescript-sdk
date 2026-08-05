import { afterEach, describe, expect, it, vi } from "vitest";

import { resumeOnDrop } from "./resume.ts";
import type { WatcherOf, WatchState } from "./watcher.ts";

interface DownEvents {
  readonly close: { readonly code: number };
}

/**
 * A watcher that is always down.
 *
 * Every reconnect attempt fails and ends in a `close`, exactly as the real
 * controller does, so the backoff loop is driven without a socket.
 */
function downWatcher() {
  const closeListeners: (() => void)[] = [];
  const attemptedAt: number[] = [];
  let state: WatchState = "open";

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
      attemptedAt.push(Date.now());
      /* A failed attempt reports itself through close, which is what
       * schedules the next backoff step.
       */
      queueMicrotask(() => {
        for (const listener of closeListeners) listener();
      });
      return Promise.reject(new Error("still down"));
    },
    disconnect() {},
    close() {},
  };

  const drop = (): void => {
    state = "disconnected";
    for (const listener of closeListeners) listener();
  };

  return { watcher, drop, attemptedAt };
}

/** The gaps between successive reconnect attempts. */
function delays(attemptedAt: readonly number[], from: number): number[] {
  const marks = [from, ...attemptedAt];
  return attemptedAt.map((_, index) => (marks[index + 1] as number) - (marks[index] as number));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("resumeOnDrop", () => {
  it("doubles the delay each attempt and holds at the ceiling", async () => {
    vi.useFakeTimers();
    const { watcher, drop, attemptedAt } = downWatcher();
    const start = Date.now();

    /* The delay policy is injected, so the schedule is exact. */
    resumeOnDrop(
      watcher,
      { baseDelayMs: 1_000, maxDelayMs: 8_000 },
      {
        schedule: (attempt, retry) => Math.min(retry.maxDelayMs, retry.baseDelayMs * 2 ** attempt),
      },
    );

    drop();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(delays(attemptedAt, start).slice(0, 6)).toEqual([
      1_000, 2_000, 4_000, 8_000, 8_000, 8_000,
    ]);
  });
});
