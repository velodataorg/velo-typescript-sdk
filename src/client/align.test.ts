import { describe, expect, it } from "vitest";

import { VeloError } from "../transport/error.js";
import { alignRange } from "./align.js";

describe("alignRange", () => {
  it("floors begin and ceils end to minute buckets", () => {
    const range = {
      begin: Date.UTC(2026, 0, 5, 12, 30, 45, 123),
      end: Date.UTC(2026, 0, 5, 12, 34, 0, 1),
    };
    expect(alignRange(range, "1m")).toEqual({
      begin: Date.UTC(2026, 0, 5, 12, 30),
      end: Date.UTC(2026, 0, 5, 12, 35),
    });
  });

  it("leaves already-aligned ranges untouched", () => {
    const range = { begin: Date.UTC(2026, 0, 5, 12, 30), end: Date.UTC(2026, 0, 5, 13, 0) };
    expect(alignRange(range, "1m")).toEqual(range);
    expect(alignRange(range, "30m")).toEqual(range);
  });

  it("aligns hour resolutions to their step within the UTC day", () => {
    const range = {
      begin: Date.UTC(2026, 0, 5, 5, 0),
      end: Date.UTC(2026, 0, 5, 13, 0),
    };
    expect(alignRange(range, "4h")).toEqual({
      begin: Date.UTC(2026, 0, 5, 4, 0),
      end: Date.UTC(2026, 0, 5, 16, 0),
    });
  });

  it("aligns 1D to UTC midnights", () => {
    const range = {
      begin: Date.UTC(2026, 0, 5, 12, 0),
      end: Date.UTC(2026, 0, 6, 12, 0),
    };
    expect(alignRange(range, "1D")).toEqual({
      begin: Date.UTC(2026, 0, 5),
      end: Date.UTC(2026, 0, 7),
    });
  });

  it("aligns 1W to calendar Mondays, not epoch multiples", () => {
    // 2026-01-05 and 2026-01-12 are Mondays.
    const range = {
      begin: Date.UTC(2026, 0, 7, 9, 30), // Wednesday
      end: Date.UTC(2026, 0, 13, 15, 0), // Tuesday
    };
    const aligned = alignRange(range, "1W");
    expect(aligned).toEqual({
      begin: Date.UTC(2026, 0, 5),
      end: Date.UTC(2026, 0, 19),
    });
    expect(new Date(aligned.begin).getUTCDay()).toBe(1); // Monday, Thursday if epoch-modular
  });

  it("leaves Monday-aligned 1W ranges untouched", () => {
    const range = { begin: Date.UTC(2026, 0, 5), end: Date.UTC(2026, 0, 12) };
    expect(alignRange(range, "1W")).toEqual(range);
  });

  it("aligns 1M to month starts", () => {
    const range = {
      begin: Date.UTC(2026, 1, 14, 8, 0),
      end: Date.UTC(2026, 2, 15, 8, 0),
    };
    expect(alignRange(range, "1M")).toEqual({
      begin: Date.UTC(2026, 1, 1),
      end: Date.UTC(2026, 3, 1),
    });
  });

  it("leaves month-aligned 1M ranges untouched", () => {
    const range = { begin: Date.UTC(2026, 1, 1), end: Date.UTC(2026, 2, 1) };
    expect(alignRange(range, "1M")).toEqual(range);
  });

  it("rejects invalid ranges", () => {
    const end = Date.UTC(2026, 0, 5);
    expect(() => alignRange({ begin: -1, end }, "1m")).toThrow(VeloError);
    expect(() => alignRange({ begin: 1.5, end }, "1m")).toThrow(VeloError);
    expect(() => alignRange({ begin: end, end }, "1m")).toThrow(/after begin/);
    expect(() => alignRange({ begin: end, end: end - 1 }, "1m")).toThrow(VeloError);
    expect(() => alignRange({ begin: 0, end: Number.NaN }, "1m")).toThrow(VeloError);
  });
});
