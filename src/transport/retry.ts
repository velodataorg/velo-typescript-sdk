import { assert } from "../util/assert.js";
import { VeloConnectionError, VeloError } from "./error.js";

export interface RetryOptions {
  /** Max retry attempts after the initial request. */
  retries: number;
  /** First backoff delay; doubles per attempt. */
  baseDelayMs: number;
  /** Backoff ceiling. */
  maxDelayMs: number;
}

export const DEFAULT_RETRY: RetryOptions = {
  retries: 5,
  baseDelayMs: 500,
  maxDelayMs: 10_000,
};

/**
 * Asserts a merged retry config is usable. A NaN or undefined smuggled into
 * `retries` makes the attempt-cutoff comparison always false — an unbounded
 * retry loop — and bad delays degrade to zero backoff, so fail loudly instead.
 */
export function validateRetryOptions(retry: RetryOptions): void {
  assert(
    Number.isSafeInteger(retry.retries) && retry.retries >= 0,
    () => `retries must be a non-negative integer (got ${retry.retries})`,
  );
  assert(
    Number.isFinite(retry.baseDelayMs) && retry.baseDelayMs >= 0,
    () => `baseDelayMs must be a non-negative number of milliseconds (got ${retry.baseDelayMs})`,
  );
  assert(
    Number.isFinite(retry.maxDelayMs) && retry.maxDelayMs >= 0,
    () => `maxDelayMs must be a non-negative number of milliseconds (got ${retry.maxDelayMs})`,
  );
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

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

/** Parse a Retry-After header: either delay-seconds or an HTTP-date. */
export function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get("retry-after");
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1000 : undefined;
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

export function backoffMs(attempt: number, retry: RetryOptions, retryAfter?: number): number {
  const exponential = Math.min(retry.maxDelayMs, retry.baseDelayMs * 2 ** attempt);
  const jittered = exponential * (0.5 + Math.random() * 0.5);
  // A server-provided Retry-After wins when it asks for a longer wait.
  return retryAfter !== undefined ? Math.max(retryAfter, jittered) : jittered;
}

/** Statuses retried by default: request timeout, rate limit, and transient server errors. */
export const DEFAULT_RETRYABLE_STATUSES: readonly number[] = [408, 429, 500, 502, 503, 504];

export function isRetryable(
  error: VeloError,
  retryableStatuses: readonly number[] = DEFAULT_RETRYABLE_STATUSES,
): boolean {
  if (error instanceof VeloConnectionError) return true;
  const { status } = error;
  return status !== undefined && retryableStatuses.includes(status);
}
