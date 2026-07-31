import { describe, expect, it } from "vitest";

import { VeloError } from "../../../errors.js";
import type { Equals, Expect } from "../../../util/types.js";
import type { MinuteResolution, Resolution } from "./resolution.js";
import {
  MinuteResolutionSchema,
  RESOLUTIONS,
  ResolutionSchema,
  toResolutionValue,
} from "./resolution.js";

/* The minute subset must stay every published name except calendar months. */
type _MinuteResolutionExcludesMonths = Expect<Equals<MinuteResolution, Exclude<Resolution, "1M">>>;

describe("rows resolutions", () => {
  it("maps public names to minute or calendar-month values", () => {
    expect(toResolutionValue("1m")).toEqual({ unit: "minutes", count: 1 });
    expect(toResolutionValue("4h")).toEqual({ unit: "minutes", count: 240 });
    expect(toResolutionValue("1D")).toEqual({ unit: "minutes", count: 1_440 });
    expect(toResolutionValue("1W")).toEqual({ unit: "minutes", count: 10_080 });
    expect(toResolutionValue("1M")).toEqual({ unit: "months", count: 1 });
  });

  it("publishes every supported resolution", () => {
    expect(Object.keys(RESOLUTIONS)).toEqual([
      "1m",
      "5m",
      "10m",
      "15m",
      "30m",
      "1h",
      "2h",
      "4h",
      "6h",
      "12h",
      "1D",
      "1W",
      "1M",
    ]);
  });

  it("publishes positive integer counts", () => {
    for (const value of Object.values(RESOLUTIONS)) {
      expect(Number.isInteger(value.count)).toBe(true);
      expect(value.count).toBeGreaterThan(0);
    }
  });

  it("rejects unsupported runtime input", () => {
    for (const resolution of ["3m", "1d", 60, "", "toString"]) {
      expect(() => toResolutionValue(resolution as never)).toThrow(VeloError);
    }
  });
});

describe("resolution schemas", () => {
  it("accepts every published name", () => {
    for (const name of Object.keys(RESOLUTIONS)) {
      expect(ResolutionSchema.parse(name)).toBe(name);
    }
  });

  it("derives the minute subset from the published units", () => {
    const minuteNames = Object.keys(RESOLUTIONS).filter(
      (name) => RESOLUTIONS[name as Resolution].unit === "minutes",
    );

    expect([...MinuteResolutionSchema.options]).toEqual(minuteNames);
    expect(MinuteResolutionSchema.parse("1W")).toBe("1W");
    expect(() => MinuteResolutionSchema.parse("1M")).toThrow();
  });

  it("rejects names outside the vocabulary", () => {
    for (const name of ["3m", "1d", "60", ""]) {
      expect(() => ResolutionSchema.parse(name)).toThrow();
      expect(() => MinuteResolutionSchema.parse(name)).toThrow();
    }
  });
});
