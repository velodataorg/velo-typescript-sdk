import { assert } from "../util/assert.ts";
import { MAX_TIMER_MS, sleep } from "./retry.ts";

export interface RateLimitOptions {
  /* Maximum requests the client may send within one trailing window. */
  requests: number;
  /* Length of the trailing window in milliseconds. */
  windowMs: number;
}

/* Half of the documented limit of 120 requests per 30 seconds.
 *
 * Deliberately conservative: the API counts requests per account rather than
 * per client, so the unused half stays available to a browser session, a
 * second worker, or any other consumer of the same key. It also fits the
 * halved allowance the API applies while degraded, which clients cannot
 * observe.
 */
export const DEFAULT_RATE_LIMIT: RateLimitOptions = { requests: 60, windowMs: 30_000 };

/**
 * Asserts a merged rate-limit config is usable.
 *
 * @param limit - The merged rate-limit options to check.
 * @throws {@link VeloError} If `requests` is not a positive integer, or
 * `windowMs` is not a positive integer of at most MAX_TIMER_MS.
 */
export function validateRateLimitOptions(limit: RateLimitOptions): void {
  assert(
    Number.isSafeInteger(limit.requests) && limit.requests > 0,
    () => `requests must be a positive integer (got ${limit.requests})`,
  );
  assert(
    Number.isInteger(limit.windowMs) && limit.windowMs > 0 && limit.windowMs <= MAX_TIMER_MS,
    () =>
      `windowMs must be a positive integer of at most ${MAX_TIMER_MS} milliseconds (got ${limit.windowMs})`,
  );
}

/**
 * Paces outgoing requests so no trailing window ever holds more than the
 * configured number of them.
 *
 * @remarks
 * The API enforces a fixed window, and a fixed window is one particular
 * trailing window, so never exceeding the budget in *any* trailing window
 * also satisfies the server's. A token bucket would not: a full bucket
 * spends its burst inside one server window and the first refilled token
 * lands in that same window.
 *
 * Reservations are made synchronously and in call order, so concurrent
 * callers cannot claim the same slot.
 */
export class RateLimiter {
  readonly #windowMs: number;

  /* Send times of the last `requests` reservations, oldest at the cursor.
   * Reserved times never decrease, so the cursor entry is always the oldest.
   */
  readonly #sent: Float64Array;
  #cursor = 0;

  constructor(options: RateLimitOptions) {
    validateRateLimitOptions(options);
    this.#windowMs = options.windowMs;
    this.#sent = new Float64Array(options.requests).fill(Number.NEGATIVE_INFINITY);
  }

  /**
   * Waits until this request may be sent.
   *
   * @param signal - Cancels the wait; an aborted wait still consumes its
   * reservation, which only makes the pacing more conservative.
   * @throws The signal's abort reason if aborted while waiting.
   */
  async acquire(signal?: AbortSignal): Promise<void> {
    const sendAt = this.reserve(Date.now());
    const wait = sendAt - Date.now();
    if (wait > 0) await sleep(wait, signal);
  }

  /**
   * Claims the next send slot without waiting for it.
   *
   * @param now - The current millisecond timestamp.
   * @returns The timestamp at which the reserved request may be sent.
   */
  reserve(now: number): number {
    const oldest = this.#sent[this.#cursor] as number;
    const sendAt = Math.max(now, oldest + this.#windowMs);

    this.#sent[this.#cursor] = sendAt;
    this.#cursor = (this.#cursor + 1) % this.#sent.length;
    return sendAt;
  }

  /**
   * Records that the API rejected a request as rate limited, pausing this
   * limiter for a full window.
   *
   * @remarks
   * Reaching this point means the account's budget is being spent elsewhere,
   * or the API halved its allowance, so local accounting alone was too
   * optimistic.
   *
   * @param now - The current millisecond timestamp.
   */
  penalize(now: number = Date.now()): void {
    this.#sent.fill(now);
    this.#cursor = 0;
  }
}
