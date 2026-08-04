import { describe, expect, it } from "vitest";

import { VeloError } from "../errors.ts";
import { DEFAULT_RATE_LIMIT, RateLimiter, validateRateLimitOptions } from "./rate-limit.ts";
import { MAX_TIMER_MS } from "./retry.ts";

describe("validateRateLimitOptions", () => {
  it("accepts the default", () => {
    expect(() => validateRateLimitOptions(DEFAULT_RATE_LIMIT)).not.toThrow();
  });

  it("rejects a requests count that cannot size the send log", () => {
    for (const requests of [NaN, undefined as never, Infinity, 0, -1, 1.5]) {
      expect(() => validateRateLimitOptions({ ...DEFAULT_RATE_LIMIT, requests })).toThrow(
        VeloError,
      );
    }
  });

  it("rejects a window Node timers cannot wait out", () => {
    // delays above MAX_TIMER_MS overflow Node timers, which fire almost immediately
    for (const windowMs of [NaN, undefined as never, Infinity, 0, -1, MAX_TIMER_MS + 1]) {
      expect(() => validateRateLimitOptions({ ...DEFAULT_RATE_LIMIT, windowMs })).toThrow(
        VeloError,
      );
    }
  });
});

describe("RateLimiter", () => {
  describe("reserve", () => {
    it("sends a first burst of `requests` immediately", () => {
      const limiter = new RateLimiter({ requests: 3, windowMs: 100 });
      for (let i = 0; i < 3; i++) {
        expect(limiter.reserve(1000)).toBe(1000);
      }
    });

    it("defers further sends to one window past the oldest reservation", () => {
      const limiter = new RateLimiter({ requests: 2, windowMs: 100 });
      limiter.reserve(1000);
      limiter.reserve(1030);
      expect(limiter.reserve(1040)).toBe(1100);
      expect(limiter.reserve(1040)).toBe(1130);
      expect(limiter.reserve(1040)).toBe(1200);
    });

    it("sends immediately again once the oldest send leaves the window", () => {
      const limiter = new RateLimiter({ requests: 2, windowMs: 100 });
      limiter.reserve(1000);
      limiter.reserve(1000);
      expect(limiter.reserve(1100)).toBe(1100);
    });

    it("never reserves more than `requests` sends in any trailing window", () => {
      const limiter = new RateLimiter({ requests: 5, windowMs: 100 });
      /* A hostile cadence: a saturating burst, a steady trickle while
       * backlogged, then another burst after an idle gap. */
      const nows = [
        ...Array.from({ length: 12 }, () => 0),
        ...Array.from({ length: 10 }, (_, i) => 10 + 10 * i),
        ...Array.from({ length: 8 }, () => 500),
      ];
      const sends = nows.map((now) => limiter.reserve(now));

      for (let i = 0; i + 1 < sends.length; i++) {
        expect(sends[i + 1]).toBeGreaterThanOrEqual(sends[i] as number);
      }
      for (let i = 0; i + 5 < sends.length; i++) {
        expect((sends[i + 5] as number) - (sends[i] as number)).toBeGreaterThanOrEqual(100);
      }
    });
  });

  describe("penalize", () => {
    it("pauses sending for a full window even with free slots", () => {
      const limiter = new RateLimiter({ requests: 3, windowMs: 100 });
      limiter.reserve(1000);
      limiter.penalize(1050);
      for (let i = 0; i < 3; i++) {
        expect(limiter.reserve(1050)).toBe(1150);
      }
      expect(limiter.reserve(1050)).toBe(1250);
    });

    it("defaults its timestamp to the current time", () => {
      const limiter = new RateLimiter({ requests: 1, windowMs: 100 });
      const before = Date.now();
      limiter.penalize();
      expect(limiter.reserve(before)).toBeGreaterThanOrEqual(before + 100);
    });
  });

  describe("acquire", () => {
    it("resolves immediately while the window has budget", async () => {
      // a window far above the test timeout: waiting at all fails the test
      const limiter = new RateLimiter({ requests: 2, windowMs: 30_000 });
      await limiter.acquire();
      await limiter.acquire();
    });

    it("waits out the window once the budget is spent", async () => {
      const limiter = new RateLimiter({ requests: 1, windowMs: 25 });
      const start = Date.now();
      await limiter.acquire();
      await limiter.acquire();
      expect(Date.now() - start).toBeGreaterThanOrEqual(20);
    });

    it("rejects with the abort reason and still consumes its reservation", async () => {
      const limiter = new RateLimiter({ requests: 1, windowMs: 30_000 });
      const start = Date.now();
      await limiter.acquire();

      const controller = new AbortController();
      const cancelled = new Error("user cancelled");
      const pending = limiter.acquire(controller.signal);
      controller.abort(cancelled);
      await expect(pending).rejects.toBe(cancelled);

      // the aborted wait kept its slot, pushing the next send a further window out
      expect(limiter.reserve(Date.now())).toBeGreaterThanOrEqual(start + 60_000);
    });
  });
});
