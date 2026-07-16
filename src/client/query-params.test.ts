import { describe, expect, it } from "vitest";

import type { QueryParamsProducts, QueryParams } from "./query-params.js";

const base = {
  exchanges: ["binance-futures"],
  begin: 1_767_225_600_000,
  end: 1_767_268_800_000,
  resolution: "1m",
} as const;

// products and coins each select on their own
const byProducts: QueryParams = {
  ...base,
  columns: ["open_price", "funding_rate"],
  products: ["BTCUSDT"],
};
const byCoins: QueryParams = {
  ...base,
  columns: ["funding_rate"],
  coins: ["BTC"],
};

// @ts-expect-error products and coins are mutually exclusive
const both: QueryParams = {
  ...base,
  columns: ["open_price"],
  products: ["BTCUSDT"],
  coins: ["BTC"],
};

// @ts-expect-error one of products or coins is required
const neither: QueryParams = { ...base, columns: ["open_price"] };

const wrongColumn: QueryParamsProducts<"spot"> = {
  ...base,
  exchanges: ["binance"],
  // @ts-expect-error funding_rate is a futures column, not a spot column
  columns: ["funding_rate"],
  products: ["BTCUSDT"],
};

const wrongExchange: QueryParamsProducts<"spot"> = {
  ...base,
  // @ts-expect-error binance-futures is a futures exchange, not a spot exchange
  exchanges: ["binance-futures"],
  columns: ["close_price"],
  products: ["BTCUSDT"],
};

describe("QueryParams", () => {
  it("compiles the valid shapes above", () => {
    expect(byProducts.products).toEqual(["BTCUSDT"]);
    expect(byCoins.coins).toEqual(["BTC"]);
    expect([both, neither, wrongColumn, wrongExchange]).toBeDefined();
  });
});
