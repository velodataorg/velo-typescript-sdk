import { describe, expect, it } from "vitest";

import { VeloError } from "../../errors.js";
import { RESOLUTIONS, toResolutionValue } from "./resolution.js";

describe("toResolutionValue", () => {
  it("maps fixed-length resolutions to minute counts", () => {
    expect(toResolutionValue("1m")).toEqual({ unit: "minutes", count: 1 });
    expect(toResolutionValue("30m")).toEqual({ unit: "minutes", count: 30 });
    expect(toResolutionValue("4h")).toEqual({ unit: "minutes", count: 240 });
    expect(toResolutionValue("1D")).toEqual({ unit: "minutes", count: 1440 });
    expect(toResolutionValue("1W")).toEqual({ unit: "minutes", count: 10_080 });
  });

  it("maps calendar resolutions to month counts", () => {
    expect(toResolutionValue("1M")).toEqual({ unit: "months", count: 1 });
  });

  it("satisfies the server's divisibility rules for every minute entry", () => {
    for (const value of Object.values(RESOLUTIONS)) {
      if (value.unit !== "minutes") continue;
      if (value.count > 15 && value.count < 60) expect(value.count % 15).toBe(0);
      if (value.count > 60) expect(value.count % 60).toBe(0);
    }
  });

  it("throws for unsupported resolutions (plain-JS callers)", () => {
    expect(() => toResolutionValue("3m" as never)).toThrow(VeloError);
    expect(() => toResolutionValue("1d" as never)).toThrow(/expected one of/);
    expect(() => toResolutionValue("1w" as never)).toThrow(VeloError);
    expect(() => toResolutionValue("toString" as never)).toThrow(VeloError);
    expect(() => toResolutionValue(60 as never)).toThrow(VeloError);
    expect(() => toResolutionValue("" as never)).toThrow(VeloError);
  });
});
