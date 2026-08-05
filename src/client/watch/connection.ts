import { backoffMs, MAX_TIMER_MS } from "../../transport/retry.ts";
import { DEFAULT_RETRY } from "../../transport/retry.ts";
import { assert } from "../../util/assert.ts";
import type { WatcherOf } from "./watcher.ts";

/**
 * Backoff for establishing and maintaining a live subscription.
 *
 * Separate from the HTTP `RetryOptions` in one respect: `retries` is
 * optional. Omitted keeps trying until the subscription connects or its
 * watcher is intentionally ended.
 */
export interface ResumeOptions {
  /**
   * Automatic retry dials before giving up.
   *
   * The initial sequence makes one immediate dial plus up to `retries`
   * redials. After an established connection drops, it makes up to `retries`
   * redials. Omitted keeps retrying.
   */
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
 * Additional inputs for {@link maintainConnection}.
 *
 * `signal` is the production cancellation input passed by the client.
 * `schedule` is an injectable test seam for replacing the randomised default
 * with a deterministic policy. These implementation details are deliberately
 * not part of the package's public surface.
 */
export interface MaintainConnectionDeps {
  /** Replaces the reconnection policy. Defaults to jittered backoff. */
  readonly schedule?: ResumeSchedule;
  /** Cancels a pending initial connection or reconnect backoff. */
  readonly signal?: AbortSignal | undefined;
}

/**
 * Keeps one watcher connected, from its initial attempt through later drops.
 *
 * One supervisor owns every automatic connection attempt. The returned
 * promise resolves the first time the watcher opens; after that, the same
 * supervisor remains attached and reconnects unexpected drops. A successful
 * connection resets the attempt counter, so every outage gets a fresh retry
 * budget.
 *
 * `disconnect()` leaves the watcher idle and `close()` leaves it closed, so
 * neither resumes. Aborting `deps.signal` cancels a pending backoff and lets
 * the watcher surface the signal's reason.
 *
 * @param watcher - The subscription to keep alive.
 * @param retry - Backoff parameters, or undefined for a single initial attempt.
 * @returns A promise that settles with the first connection attempt sequence.
 */
export function maintainConnection<E extends { close: unknown }>(
  watcher: WatcherOf<E>,
  retry: ResumeOptions | undefined,
  deps: MaintainConnectionDeps = {},
): Promise<void> {
  const schedule = deps.schedule ?? exponentialBackoff;
  const { signal } = deps;
  let attempt = 0;
  let attempting = false;
  let connected = false;
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let listeningForAbort = false;
  let readySettled = false;
  let resolveReady: (() => void) | undefined;
  let rejectReady: ((reason?: unknown) => void) | undefined;

  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const clearRetryTimer = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    stopListeningForAbort();
  };

  const stop = (): void => {
    if (!active) return;
    active = false;
    clearRetryTimer();
    watcher.off("close", onClose);
  };

  const resolveFirstConnection = (): void => {
    if (readySettled) return;
    readySettled = true;
    resolveReady?.();
    resolveReady = undefined;
    rejectReady = undefined;
  };

  const rejectFirstConnection = (error: unknown): void => {
    if (readySettled) return;
    readySettled = true;
    stop();
    /* The rejected watch() call cannot hand this watcher to its caller. Close
     * it permanently so its signal and user listeners cannot retain an
     * otherwise unreachable controller.
     */
    watcher.close();
    resolveReady = undefined;
    const reject = rejectReady;
    rejectReady = undefined;
    reject?.(error);
  };

  const connect = (): void => {
    if (
      !active ||
      attempting ||
      timer !== undefined ||
      (watcher.state !== "idle" && watcher.state !== "disconnected")
    ) {
      return;
    }

    attempting = true;
    void watcher.connect().then(
      () => {
        if (!active) return;
        attempting = false;
        attempt = 0;
        connected = true;
        resolveFirstConnection();

        /* connect() can resolve just before a buffered frame or socket event
         * drops the subscription. Do not lose that close while this promise's
         * continuation was waiting to run.
         */
        if (watcher.state === "disconnected") scheduleNext();
      },
      (error: unknown) => {
        if (!active) return;
        attempting = false;
        if (watcher.state === "disconnected") scheduleNext(error);
        else if (!connected) rejectFirstConnection(error);
        else if (watcher.state === "closed") stop();
      },
    );
  };

  const scheduleNext = (initialError?: unknown): void => {
    if (!active || attempting || timer !== undefined || watcher.state !== "disconnected") return;

    if (!retry) {
      if (!connected) rejectFirstConnection(initialError);
      return;
    }

    const wait = schedule(attempt++, retry);
    if (wait === undefined) {
      if (!connected) rejectFirstConnection(initialError);
      return;
    }

    timer = setTimeout(() => {
      stopListeningForAbort();
      timer = undefined;
      if (watcher.state === "closed") stop();
      else if (watcher.state === "disconnected") connect();
    }, wait);
    listenForAbort();

    /* A pending reconnect must not hold a Node process open on its own.
     * Called optionally because browsers return a plain number from
     * setTimeout, where the method does not exist.
     */
    timer.unref?.();
  };

  function onClose(): void {
    if (watcher.state === "disconnected") {
      /* A close outside one of our own attempts starts a new outage. This
       * also lets a successful explicit connect() reset an exhausted budget.
       */
      if (!attempting) {
        if (timer === undefined) attempt = 0;
        scheduleNext();
      }
      return;
    }

    if (watcher.state === "idle") {
      clearRetryTimer();
      attempt = 0;
    } else if (watcher.state === "closed" && !attempting) {
      stop();
    }
  }

  function onAbort(): void {
    if (!connected) {
      rejectFirstConnection(
        signal?.reason ?? new DOMException("The operation was aborted.", "AbortError"),
      );
    } else {
      stop();
    }
  }

  function listenForAbort(): void {
    if (signal === undefined || listeningForAbort) return;
    signal.addEventListener("abort", onAbort, { once: true });
    listeningForAbort = true;
  }

  function stopListeningForAbort(): void {
    if (signal === undefined || !listeningForAbort) return;
    signal.removeEventListener("abort", onAbort);
    listeningForAbort = false;
  }

  watcher.on("close", onClose);

  if (watcher.state === "open") {
    connected = true;
    resolveFirstConnection();
  } else {
    connect();
  }

  return ready;
}
