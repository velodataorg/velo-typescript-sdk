import { describe, expect, expectTypeOf, it } from "vitest";

import {
  FUTURES_COLUMNS,
  FUTURES_EXCHANGES,
  OPTIONS_COLUMNS,
  OPTIONS_EXCHANGES,
  RESOLUTIONS,
  ROWS_BASE_COLUMNS,
  SPOT_COLUMNS,
  SPOT_EXCHANGES,
} from "./index.js";
import type { FuturesRow, FuturesStandardParams, OptionsParams, SpotParams } from "./index.js";

describe("rows public exports", () => {
  it("exports market vocabularies and row metadata", () => {
    expect(FUTURES_EXCHANGES).toContain("binance-futures");
    expect(OPTIONS_EXCHANGES).toEqual(["deribit"]);
    expect(SPOT_EXCHANGES).toContain("coinbase");
    expect(FUTURES_COLUMNS).toContain("funding_rate");
    expect(OPTIONS_COLUMNS).toContain("iv_1m");
    expect(SPOT_COLUMNS).toContain("close_price");
    expect(ROWS_BASE_COLUMNS).toEqual(["exchange", "coin", "product", "time"]);
    expect(RESOLUTIONS["1M"]).toEqual({ unit: "months", count: 1 });
  });

  it("exports market-specific parameter and inferred row types", () => {
    expectTypeOf<FuturesStandardParams["exchanges"][number]>().toEqualTypeOf<
      (typeof FUTURES_EXCHANGES)[number]
    >();
    expectTypeOf<SpotParams["columns"][number]>().toEqualTypeOf<(typeof SPOT_COLUMNS)[number]>();
    expectTypeOf<OptionsParams["columns"][number]>().toEqualTypeOf<
      (typeof OPTIONS_COLUMNS)[number]
    >();
    expectTypeOf<FuturesRow<"close_price">["close_price"]>().toEqualTypeOf<number | null>();
  });
});
