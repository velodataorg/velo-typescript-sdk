import { describe, expect, it } from "vitest";

import { EXCHANGES, FUTURES_COLUMNS, VeloError, VeloRateLimitError } from "./index.js";

describe("public entry", () => {
  it("exports API constants", () => {
    expect(EXCHANGES).toContain("binance-futures");
    expect(FUTURES_COLUMNS).toContain("funding_rate");
  });

  it("exports the error hierarchy", () => {
    expect(new VeloRateLimitError("x")).toBeInstanceOf(VeloError);
  });
});
