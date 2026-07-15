import { describe, expect, it } from "vitest";

import type { RowsParamsV1 } from "./param.js";

const base = {
  exchanges: ["binance-futures"],
  begin: 1_767_225_600_000,
  end: 1_767_268_800_000,
  resolution: "1m",
} as const;

// products and coins each select on their own
const byProducts: RowsParamsV1 = {
  ...base,
  type: "futures",
  columns: ["open_price", "funding_rate"],
  products: ["BTCUSDT"],
};
const byCoins: RowsParamsV1 = {
  ...base,
  type: "futures",
  columns: ["funding_rate"],
  coins: ["BTC"],
};

// @ts-expect-error products and coins are mutually exclusive
const both: RowsParamsV1 = {
  ...base,
  type: "futures",
  columns: ["open_price"],
  products: ["BTCUSDT"],
  coins: ["BTC"],
};

// @ts-expect-error one of products or coins is required
const neither: RowsParamsV1 = { ...base, type: "futures", columns: ["open_price"] };

// @ts-expect-error funding_rate is a futures column, not a spot column
const wrongColumn: RowsParamsV1 = {
  ...base,
  type: "spot",
  columns: ["funding_rate"],
  products: ["BTCUSDT"],
};

describe("RowsParamsV1", () => {
  it("compiles the valid shapes above", () => {
    expect(byProducts.products).toEqual(["BTCUSDT"]);
    expect(byCoins.coins).toEqual(["BTC"]);
    expect([both, neither, wrongColumn]).toBeDefined();
  });
});
