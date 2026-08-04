import { describe, expect, it } from "vitest";

import { VeloError } from "../../../errors.ts";
import { MAX_REQUESTS_PER_QUERY } from "../query.ts";
import { alignRange, chunkByStep, clampEnd } from "./range.ts";

describe("alignRange", () => {
  it("floors begin and ceils end to fixed-length buckets", () => {
    expect(
      alignRange(
        {
          begin: Date.UTC(2026, 0, 5, 5, 23, 45),
          end: Date.UTC(2026, 0, 5, 13, 0, 0, 1),
        },
        "4h",
      ),
    ).toEqual({
      begin: Date.UTC(2026, 0, 5, 4),
      end: Date.UTC(2026, 0, 5, 16),
    });
  });

  it("leaves aligned ranges unchanged", () => {
    const range = {
      begin: Date.UTC(2026, 0, 5, 12, 30),
      end: Date.UTC(2026, 0, 5, 13),
    };
    expect(alignRange(range, "1m")).toEqual(range);
    expect(alignRange(range, "30m")).toEqual(range);
  });

  it("aligns weeks to UTC Mondays", () => {
    expect(
      alignRange(
        {
          begin: Date.UTC(2026, 0, 7, 9, 30),
          end: Date.UTC(2026, 0, 13, 15),
        },
        "1W",
      ),
    ).toEqual({
      begin: Date.UTC(2026, 0, 5),
      end: Date.UTC(2026, 0, 19),
    });
  });

  it("aligns months to UTC month starts", () => {
    expect(
      alignRange(
        {
          begin: Date.UTC(2026, 1, 14, 8),
          end: Date.UTC(2026, 2, 15, 8),
        },
        "1M",
      ),
    ).toEqual({
      begin: Date.UTC(2026, 1, 1),
      end: Date.UTC(2026, 3, 1),
    });
  });

  it("leaves week- and month-aligned ranges unchanged", () => {
    const weeks = { begin: Date.UTC(2026, 0, 5), end: Date.UTC(2026, 0, 12) };
    const months = { begin: Date.UTC(2026, 1, 1), end: Date.UTC(2026, 2, 1) };

    expect(alignRange(weeks, "1W")).toEqual(weeks);
    expect(alignRange(months, "1M")).toEqual(months);
  });

  it("rejects invalid or unrepresentable ranges", () => {
    const end = Date.UTC(2026, 0, 5);
    for (const range of [
      { begin: -1, end },
      { begin: 1.5, end },
      { begin: end, end },
      { begin: end, end: end - 1 },
      { begin: 0, end: Number.NaN },
      { begin: 0, end: 1e16 },
    ]) {
      expect(() => alignRange(range, "1M")).toThrow(VeloError);
    }
  });
});

describe("clampEnd", () => {
  const now = Date.UTC(2026, 0, 5, 12, 30);

  it("returns ranges that end at or before now unchanged", () => {
    expect(clampEnd({ begin: 0, end: now }, 0, now)).toEqual({ begin: 0, end: now });
    expect(clampEnd({ begin: 0, end: now - 1 }, 0, now)).toEqual({ begin: 0, end: now - 1 });
  });

  it("caps an end ceiled past now while keeping the floored begin", () => {
    const begin = now - 3_600_000;

    expect(clampEnd({ begin, end: now + 3_600_000 }, now - 60_000, now)).toEqual({
      begin,
      end: now,
    });
  });

  it("rejects a range requested entirely in the future", () => {
    expect(() => clampEnd({ begin: now, end: now + 2 }, now, now)).toThrow(VeloError);
    expect(() => clampEnd({ begin: now, end: now + 2 }, now + 1, now)).toThrow(
      /entirely in the future/,
    );
  });
});

describe("chunkByStep", () => {
  const message = (requestCount: number) => `needs ${requestCount} requests`;

  it("returns one chunk when the range fits a step", () => {
    expect(chunkByStep({ begin: 0, end: 499 }, 500, message)).toEqual([{ begin: 0, end: 499 }]);
    expect(chunkByStep({ begin: 0, end: 500 }, 500, message)).toEqual([{ begin: 0, end: 500 }]);
  });

  it("splits into contiguous half-open chunks and clamps the last", () => {
    expect(chunkByStep({ begin: 0, end: 1_001 }, 500, message)).toEqual([
      { begin: 0, end: 500 },
      { begin: 500, end: 1_000 },
      { begin: 1_000, end: 1_001 },
    ]);
  });

  it("steps from the range's begin, not from step multiples", () => {
    expect(chunkByStep({ begin: 250, end: 1_250 }, 500, message)).toEqual([
      { begin: 250, end: 750 },
      { begin: 750, end: 1_250 },
    ]);
  });

  it("rejects an empty or inverted range", () => {
    expect(() => chunkByStep({ begin: 5, end: 5 }, 500, message)).toThrow(VeloError);
    expect(() => chunkByStep({ begin: 6, end: 5 }, 500, message)).toThrow(
      /begin must be before end/,
    );
  });

  it("rejects a step that is not a positive integer", () => {
    for (const stepMs of [0, -500, 250.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => chunkByStep({ begin: 0, end: 1_000 }, stepMs, message)).toThrow(/Invalid step/);
    }
  });

  it("allows exactly the request limit and rejects one chunk past it", () => {
    const limit = MAX_REQUESTS_PER_QUERY * 500;

    expect(chunkByStep({ begin: 0, end: limit }, 500, message)).toHaveLength(
      MAX_REQUESTS_PER_QUERY,
    );
    expect(() => chunkByStep({ begin: 0, end: limit + 1 }, 500, message)).toThrow(
      `needs ${MAX_REQUESTS_PER_QUERY + 1} requests`,
    );
  });
});
