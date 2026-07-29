import { describe, expect, it, vi } from "vitest";

import { VeloConnectionError, VeloError, VeloHttpError } from "../errors.js";
import {
  backoffMs,
  DEFAULT_RETRY,
  DEFAULT_RETRYABLE_STATUSES,
  isRetryable,
  MAX_TIMER_MS,
  retryAfterMs,
  validateRetryOptions,
} from "./retry.js";

function errorWithStatus(status: number): VeloHttpError {
  return new VeloHttpError(`Velo API ${status}`, {
    status,
    body: "",
    url: "https://example.test",
    headers: {},
  });
}

describe("isRetryable", () => {
  it("retries connection errors regardless of the status list", () => {
    const error = new VeloConnectionError("socket hang up", {
      url: "https://example.test",
    });
    expect(isRetryable(error)).toBe(true);
    expect(isRetryable(error, [])).toBe(true);
  });

  it("retries every status in DEFAULT_RETRYABLE_STATUSES and nothing else", () => {
    for (const status of DEFAULT_RETRYABLE_STATUSES) {
      expect(isRetryable(errorWithStatus(status))).toBe(true);
    }
    for (const status of [400, 401, 403, 404, 418, 501]) {
      expect(isRetryable(errorWithStatus(status))).toBe(false);
    }
  });

  it("never retries errors without a status", () => {
    expect(isRetryable(new VeloError("failure"))).toBe(false);
  });

  it("accepts an explicit list of status codes", () => {
    expect(isRetryable(errorWithStatus(429), [429])).toBe(true);
    expect(isRetryable(errorWithStatus(500), [429])).toBe(false);
  });
});

describe("validateRetryOptions", () => {
  it("accepts the defaults and zero values", () => {
    expect(() => validateRetryOptions(DEFAULT_RETRY)).not.toThrow();
    expect(() => validateRetryOptions({ retries: 0, baseDelayMs: 0, maxDelayMs: 0 })).not.toThrow();
  });

  it("rejects retries that would unbound the retry loop", () => {
    // `attempt >= retries` never becomes true for NaN, undefined, or Infinity
    for (const retries of [NaN, undefined as never, Infinity, -1, 1.5]) {
      expect(() => validateRetryOptions({ ...DEFAULT_RETRY, retries })).toThrow(VeloError);
    }
  });

  it("rejects delays that would degrade to zero backoff", () => {
    // delays above MAX_TIMER_MS overflow Node timers, which also fire almost immediately
    for (const delay of [NaN, undefined as never, Infinity, -1, MAX_TIMER_MS + 1]) {
      expect(() => validateRetryOptions({ ...DEFAULT_RETRY, baseDelayMs: delay })).toThrow(
        VeloError,
      );
      expect(() => validateRetryOptions({ ...DEFAULT_RETRY, maxDelayMs: delay })).toThrow(
        VeloError,
      );
    }
  });
});

describe("retryAfterMs", () => {
  function respondWith(retryAfter?: string): Response {
    return new Response(
      "",
      retryAfter === undefined ? {} : { headers: { "retry-after": retryAfter } },
    );
  }

  it("returns undefined without a Retry-After header", () => {
    expect(retryAfterMs(respondWith())).toBeUndefined();
  });

  it("converts delta-seconds to milliseconds and rejects negative ones", () => {
    expect(retryAfterMs(respondWith("2"))).toBe(2_000);
    expect(retryAfterMs(respondWith("0"))).toBe(0);
    expect(retryAfterMs(respondWith("-1"))).toBeUndefined();
  });

  it("converts an HTTP-date to a wait from now, clamping past dates to zero", () => {
    vi.useFakeTimers();
    try {
      const now = Date.UTC(2026, 6, 13, 10);
      vi.setSystemTime(now);
      expect(retryAfterMs(respondWith(new Date(now + 2_000).toUTCString()))).toBe(2_000);
      expect(retryAfterMs(respondWith(new Date(now - 2_000).toUTCString()))).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns undefined for a malformed header", () => {
    expect(retryAfterMs(respondWith("soon"))).toBeUndefined();
  });
});

describe("backoffMs", () => {
  it("caps a server Retry-After at what Node timers support", () => {
    // e.g. `Retry-After: 99999999999` must not overflow setTimeout into a ~0ms wait
    expect(backoffMs(0, DEFAULT_RETRY, Number.MAX_SAFE_INTEGER)).toBe(MAX_TIMER_MS);
  });

  it("lets a longer Retry-After win over the backoff", () => {
    expect(backoffMs(0, DEFAULT_RETRY, 60_000)).toBe(60_000);
  });
});
