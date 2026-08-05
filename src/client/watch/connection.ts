import { VeloError } from "../../errors.ts";
import { backoffMs, isRetryable, MAX_TIMER_MS } from "../../transport/retry.ts";
import { DEFAULT_RETRY } from "../../transport/retry.ts";
import { assert } from "../../util/assert.ts";
import type { WatcherOf } from "./watcher.ts";

/**
 * Backoff for establishing and maintaining a live subscription.
 *
 * Separate from the HTTP `RetryOptions` in one respect: `retries` is
 * optional, and what omitting it means depends on whether the subscription
 * has ever connected.
 */
export interface ResumeOptions {
  /**
   * Automatic retry dials before giving up.
   *
   * Each sequence makes one immediate dial plus up to `retries` redials.
   * Omitted bounds the initial sequence, so a subscription that never
   * connects reports the failure, and leaves later outages unbounded, since
   * an endpoint that has served once is worth waiting on.
   *
   * A dial the server refuses outright ends the sequence whatever the
   * budget: the next dial would only be refused the same way.
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

/** What a policy knows about the attempt it is being asked to schedule. */
export interface ResumeContext {
  /** Zero-based index of the attempt about to be made. */
  readonly attempt: number;
  /** Whether a connection has succeeded at least once for this watcher. */
  readonly connected: boolean;
  /** Why the previous attempt failed, when one has. */
  readonly error: unknown;
}

/**
 * A reconnection policy: how long to wait, or `undefined` to stop retrying.
 *
 * Every reason to give up is one policy decision rather than a branch beside
 * it — a rejected handshake, an exhausted budget, a caller who never got a
 * connection at all — so a policy is replaceable whole.
 */
export type ResumeSchedule = (context: ResumeContext, retry: ResumeOptions) => number | undefined;

/**
 * Attempts allowed before a first connection, when the caller sets no budget.
 *
 * Unbounded retries suit an established subscription: the endpoint is known
 * good, so an outage is transient. Before that, an unbounded policy would
 * leave a caller waiting forever on an endpoint that may never accept them.
 */
const DEFAULT_INITIAL_RETRIES = DEFAULT_RETRY.retries;

const exponentialBackoff: ResumeSchedule = ({ attempt, connected, error }, retry) => {
  if (error instanceof VeloError && !isRetryable(error)) return undefined;
  const budget = connected ? retry.retries : (retry.retries ?? DEFAULT_INITIAL_RETRIES);
  if (budget !== undefined && attempt >= budget) return undefined;
  return backoffMs(attempt, retry);
};

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

    const wait = schedule({ attempt: attempt++, connected, error: initialError }, retry);
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
