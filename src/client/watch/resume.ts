import { backoffMs, MAX_TIMER_MS } from "../../transport/retry.ts";
import { DEFAULT_RETRY } from "../../transport/retry.ts";
import { assert } from "../../util/assert.ts";
import type { WatcherOf } from "./watcher.ts";

/**
 * Backoff for reopening a dropped subscription.
 *
 * Separate from the HTTP `RetryOptions` in one respect: `retries` is
 * optional. No caller waits on a feed to fail, so the useful default is to
 * keep trying rather than to give up after a fixed count.
 */
export interface ResumeOptions {
  /** Attempts before giving up. Omitted keeps retrying. */
  readonly retries?: number;
  /** First backoff delay; doubles per attempt. */
  readonly baseDelayMs: number;
  /** Backoff ceiling. */
  readonly maxDelayMs: number;
}

/** Reconnection defaults for a live subscription. */
export const DEFAULT_WATCH_RECONNECT: ResumeOptions = {
  baseDelayMs: DEFAULT_RETRY.baseDelayMs,
  maxDelayMs: 30_000,
};

/**
 * Resolves the `reconnect` option to backoff parameters, or off.
 *
 * @param reconnect - `false` to disable, `true`/omitted for the defaults, or
 * an object overriding part of them.
 * @throws If the overrides are not usable delays or attempt counts.
 */
export function prepareReconnect(
  reconnect: boolean | Partial<ResumeOptions> | undefined,
): ResumeOptions | undefined {
  if (reconnect === false) return undefined;
  if (reconnect === undefined || reconnect === true) return DEFAULT_WATCH_RECONNECT;

  assert(
    reconnect !== null && typeof reconnect === "object" && !Array.isArray(reconnect),
    "reconnect must be a boolean or an object",
  );

  const merged = { ...DEFAULT_WATCH_RECONNECT, ...reconnect };
  assert(
    merged.retries === undefined || (Number.isSafeInteger(merged.retries) && merged.retries >= 0),
    () => `retries must be a non-negative integer (got ${String(merged.retries)})`,
  );
  for (const field of ["baseDelayMs", "maxDelayMs"] as const) {
    const delay = merged[field];
    assert(
      Number.isFinite(delay) && delay >= 0 && delay <= MAX_TIMER_MS,
      () => `${field} must be between 0 and ${MAX_TIMER_MS} milliseconds (got ${String(delay)})`,
    );
  }
  return merged;
}

/**
 * A reconnection policy: how long to wait before `attempt`, or `undefined`
 * to stop retrying.
 *
 * Folding "when to give up" into the same value as "how long to wait" leaves
 * one decision point rather than two, so a policy is replaceable whole.
 */
export type ResumeSchedule = (attempt: number, retry: ResumeOptions) => number | undefined;

/** Jittered exponential backoff, bounded by `retries` when one is set. */
const exponentialBackoff: ResumeSchedule = (attempt, retry) =>
  retry.retries !== undefined && attempt >= retry.retries ? undefined : backoffMs(attempt, retry);

/**
 * Overridable collaborators for {@link resumeOnDrop}.
 *
 * Deliberately not part of the package's public surface: the default policy
 * is randomised, and a caller wanting a deterministic schedule is a test,
 * not a consumer.
 */
export interface ResumeDeps {
  /** Replaces the reconnection policy. Defaults to jittered backoff. */
  readonly schedule?: ResumeSchedule;
}

/**
 * Reopens a subscription after an unexpected drop, with jittered backoff.
 *
 * A watcher lands in `disconnected` only when it lost a connection it did not
 * mean to lose; `disconnect()` leaves it `idle` and `close()` leaves it
 * `closed`, so neither resumes. Each failed attempt emits `close` again,
 * which drives the next backoff step.
 *
 * @param watcher - The subscription to keep alive.
 * @param retry - Backoff parameters.
 */
export function resumeOnDrop<E extends { close: unknown }>(
  watcher: WatcherOf<E>,
  retry: ResumeOptions,
  deps: ResumeDeps = {},
): void {
  const schedule = deps.schedule ?? exponentialBackoff;
  let attempt = 0;

  const scheduleNext = (): void => {
    const wait = schedule(attempt++, retry);
    if (wait === undefined) return;

    const timer = setTimeout(() => {
      if (watcher.state !== "disconnected") return;
      void watcher.connect().then(
        () => {
          attempt = 0;
        },
        () => {
          /* The close event this failure emits schedules the next attempt. */
        },
      );
    }, wait);

    /* A pending reconnect must not hold a Node process open on its own.
     * Called optionally because browsers return a plain number from
     * setTimeout, where the method does not exist.
     */
    timer.unref?.();
  };

  watcher.on("close", () => {
    if (watcher.state === "disconnected") scheduleNext();
  });
}
