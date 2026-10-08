import { MAX_TIMER_MS } from "../../transport/retry.ts";
import { isAbortSignal } from "../../util/abort.ts";
import { assert } from "../../util/assert.ts";

export const DEFAULT_WATCH_HEARTBEAT_TIMEOUT = 5 * 60 * 1000;
export const DEFAULT_WATCH_CONNECT_TIMEOUT = 30 * 1000;

/**
 * Options every watcher accepts, whatever it subscribes to.
 *
 * Declared once so each kind's options are this contract under its own
 * name rather than a copy that can drift.
 */
export interface WatcherOptions {
  /* Closes the watcher when aborted. */
  readonly signal?: AbortSignal;
  /* Maximum milliseconds between server heartbeats before the connection is presumed lost. */
  readonly heartbeatTimeout?: number;
  /* Maximum milliseconds for connect() to reach an open subscription. */
  readonly connectTimeout?: number;
  /**
   * Replaces the default reporting for event-listener failures.
   *
   * Receives every error thrown — or promise rejection returned — by a
   * listener. Without it, failures go to `reportError` where the runtime
   * provides it and `console.error` otherwise. Should not throw or reject;
   * if it does, both errors fall back to the default reporting.
   */
  readonly onListenerError?: (error: unknown) => unknown;
}

/* {@link WatcherOptions} with every default applied. */
export interface PreparedWatcherOptions {
  readonly signal: AbortSignal | undefined;
  readonly heartbeatTimeout: number;
  readonly connectTimeout: number;
  readonly onListenerError: ((error: unknown) => unknown) | undefined;
}

/**
 * Validates watcher options and fills in the defaults.
 *
 * @param options - The caller's options; omitted means all defaults.
 * @returns Every option resolved to a concrete value.
 * @throws A VeloError when an option is not usable.
 */
export function prepareWatcherOptions(options?: WatcherOptions): PreparedWatcherOptions {
  /* Omitted is valid; null or a non-object is not. */
  assert(
    options === undefined ||
      (options !== null && typeof options === "object" && !Array.isArray(options)),
    "watch options must be an object",
  );

  const { signal, onListenerError } = options ?? {};
  assert(signal === undefined || isAbortSignal(signal), "signal must be an AbortSignal");
  assert(
    onListenerError === undefined || typeof onListenerError === "function",
    "onListenerError must be a function",
  );

  const heartbeatTimeout = options?.heartbeatTimeout ?? DEFAULT_WATCH_HEARTBEAT_TIMEOUT;
  assert(
    isTimerDuration(heartbeatTimeout),
    () =>
      `heartbeatTimeout must be a positive integer of at most ${MAX_TIMER_MS} milliseconds (got ${String(heartbeatTimeout)})`,
  );

  const connectTimeout = options?.connectTimeout ?? DEFAULT_WATCH_CONNECT_TIMEOUT;
  assert(
    isTimerDuration(connectTimeout),
    () =>
      `connectTimeout must be a positive integer of at most ${MAX_TIMER_MS} milliseconds (got ${String(connectTimeout)})`,
  );

  return { signal, heartbeatTimeout, connectTimeout, onListenerError };
}

/**
 * Checks that a value can be handed to `setTimeout` as written.
 *
 * @param value - A candidate duration in milliseconds.
 * @returns Whether `value` is a positive integer within the timer range.
 */
function isTimerDuration(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= MAX_TIMER_MS;
}
