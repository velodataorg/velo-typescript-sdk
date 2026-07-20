import { describe, expect, it } from "vitest";

import { VeloError } from "../../errors.js";
import { RESOLUTIONS, toResolutionValue } from "./resolution.js";

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

  it("rejects unsupported runtime input", () => {
    for (const resolution of ["3m", "1d", 60, "", "toString"]) {
      expect(() => toResolutionValue(resolution as never)).toThrow(VeloError);
    }
  });
});
