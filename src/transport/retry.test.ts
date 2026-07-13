import { describe, expect, it } from "vitest";

import { VeloConnectionError, VeloError } from "./error.js";
import { DEFAULT_RETRYABLE_STATUSES, isRetryable } from "./retry.js";

function errorWithStatus(status?: number): VeloError {
  return new VeloError(`Velo API ${status ?? "failure"}`, { status });
}

describe("isRetryable", () => {
  it("retries connection errors regardless of the status list", () => {
    const error = new VeloConnectionError("socket hang up");
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
    expect(isRetryable(errorWithStatus())).toBe(false);
  });

  it("accepts an explicit list of status codes", () => {
    expect(isRetryable(errorWithStatus(429), [429])).toBe(true);
    expect(isRetryable(errorWithStatus(500), [429])).toBe(false);
  });
});
