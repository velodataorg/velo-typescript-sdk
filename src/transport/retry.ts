import { VeloConnectionError, VeloError, VeloHttpError } from "../errors.ts";
import { assert } from "../util/assert.ts";

export interface RetryOptions {
  /* Max retry attempts after the initial request. */
  retries: number;
  /* First backoff delay; doubles per attempt. */
  baseDelayMs: number;
  /* Backoff ceiling. */
  maxDelayMs: number;
}

export const DEFAULT_RETRY: RetryOptions = {
  retries: 5,
  baseDelayMs: 500,
  maxDelayMs: 10_000,
};

/* The longest wait Node timers support: setTimeout and AbortSignal.timeout
 * clamp delays above 2^31 - 1 ms (~24.8 days) to fire almost immediately.
 */
export const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * Asserts a merged retry config is usable.
 *
 * @remarks
 * A NaN or undefined smuggled into `retries` makes the attempt-cutoff
 * comparison always false — an unbounded retry loop — bad delays degrade to
 * zero backoff, and delays past MAX_TIMER_MS overflow Node timers, so fail
 * loudly instead.
 *
 * @param retry - The merged retry options to check.
 * @throws If any field is not a non-negative number (integer for `retries`,
 * at most MAX_TIMER_MS for the delays).
 */
export function validateRetryOptions(retry: RetryOptions): void {
  assert(
    Number.isSafeInteger(retry.retries) && retry.retries >= 0,
    () => `retries must be a non-negative integer (got ${retry.retries})`,
  );
  for (const field of ["baseDelayMs", "maxDelayMs"] as const) {
    const delay = retry[field];
    assert(
      Number.isFinite(delay) && delay >= 0 && delay <= MAX_TIMER_MS,
      () => `${field} must be between 0 and ${MAX_TIMER_MS} milliseconds (got ${delay})`,
    );
  }
}

/**
 * @param signal - An already-aborted signal.
 * @returns The signal's abort reason, or a fresh `AbortError` DOMException
 * when none was provided.
 */
function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

/**
 * Waits for `ms` milliseconds, abortable.
 *
 * @param ms - How long to wait.
 * @param signal - Cancels the wait; the timer is cleared on abort.
 * @returns Resolves after the wait; rejects with the signal's abort reason
 * if aborted before or during it.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal as AbortSignal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Parses a response's Retry-After header: either delay-seconds or an
 * HTTP-date.
 *
 * @param response - The response to read the header from.
 * @returns The wait in milliseconds, or undefined when the header is
 * missing, malformed, or in the past.
 */
export function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get("retry-after");
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1000 : undefined;
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

/**
 * The delay before the next retry: capped exponential backoff with jitter.
 *
 * @param attempt - The zero-based index of the attempt that just failed.
 * @param retry - The backoff parameters.
 * @param retryAfter - A server-requested wait in milliseconds, if any.
 * @returns The wait in milliseconds; a server-provided `retryAfter` wins
 * when it asks for a longer wait than the backoff, capped at MAX_TIMER_MS
 * because a longer setTimeout would fire almost immediately.
 */
export function backoffMs(
  attempt: number,
  retry: Pick<RetryOptions, "baseDelayMs" | "maxDelayMs">,
  retryAfter?: number,
): number {
  const exponential = Math.min(retry.maxDelayMs, retry.baseDelayMs * 2 ** attempt);
  const jittered = exponential * (0.5 + Math.random() * 0.5);
  const delay = retryAfter !== undefined ? Math.max(retryAfter, jittered) : jittered;
  return Math.min(delay, MAX_TIMER_MS);
}

/* Statuses retried by default: request timeout, rate limit, and transient server errors. */
export const DEFAULT_RETRYABLE_STATUSES: readonly number[] = [408, 429, 500, 502, 503, 504];

/**
 * Whether a failure is worth retrying.
 *
 * @param error - The failure of the attempt.
 * @param retryableStatuses - The HTTP statuses considered transient.
 * @returns True for every connection-level failure, and for HTTP failures
 * whose status is in `retryableStatuses`.
 */
export function isRetryable(
  error: VeloError,
  retryableStatuses: readonly number[] = DEFAULT_RETRYABLE_STATUSES,
): boolean {
  if (error instanceof VeloConnectionError) return true;
  return error instanceof VeloHttpError && retryableStatuses.includes(error.status);
}
