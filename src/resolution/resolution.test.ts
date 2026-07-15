import { describe, expect, it } from "vitest";

import { VeloError } from "../transport/error.js";
import { RESOLUTIONS, resolutionValue } from "./resolution.js";

describe("resolutionValue", () => {
  it("maps fixed-length resolutions to minute counts", () => {
    expect(resolutionValue("1m")).toEqual({ unit: "minutes", count: 1 });
    expect(resolutionValue("30m")).toEqual({ unit: "minutes", count: 30 });
    expect(resolutionValue("4h")).toEqual({ unit: "minutes", count: 240 });
    expect(resolutionValue("1D")).toEqual({ unit: "minutes", count: 1440 });
    expect(resolutionValue("1W")).toEqual({ unit: "minutes", count: 10_080 });
  });

  it("maps calendar resolutions to month counts", () => {
    expect(resolutionValue("1M")).toEqual({ unit: "months", count: 1 });
  });

  it("satisfies the server's divisibility rules for every minute entry", () => {
    for (const value of Object.values(RESOLUTIONS)) {
      if (value.unit !== "minutes") continue;
      if (value.count > 15 && value.count < 60) expect(value.count % 15).toBe(0);
      if (value.count > 60) expect(value.count % 60).toBe(0);
    }
  });

  it("throws for unsupported resolutions (plain-JS callers)", () => {
    expect(() => resolutionValue("3m" as never)).toThrow(VeloError);
    expect(() => resolutionValue("1d" as never)).toThrow(/expected one of/);
    expect(() => resolutionValue("1w" as never)).toThrow(VeloError);
    expect(() => resolutionValue("toString" as never)).toThrow(VeloError);
    expect(() => resolutionValue(60 as never)).toThrow(VeloError);
    expect(() => resolutionValue("" as never)).toThrow(VeloError);
  });
});
