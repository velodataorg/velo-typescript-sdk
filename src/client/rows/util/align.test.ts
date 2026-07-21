import { describe, expect, it } from "vitest";

import { VeloError } from "../../../errors.js";
import { alignRange } from "./align.js";

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
