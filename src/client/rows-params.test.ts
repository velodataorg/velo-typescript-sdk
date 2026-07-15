import { describe, expect, it } from "vitest";

import { resolutionParams } from "./rows-params.js";

describe("resolutionParams", () => {
  it("sends minutes for fixed-length resolutions", () => {
    expect(resolutionParams("1m")).toEqual({ resolution: 1 });
    expect(resolutionParams("12h")).toEqual({ resolution: 720 });
    expect(resolutionParams("1W")).toEqual({ resolution: 10_080 });
  });

  it("sends a month count with months=true for calendar resolutions", () => {
    expect(resolutionParams("1M")).toEqual({ resolution: 1, months: true });
  });
});
