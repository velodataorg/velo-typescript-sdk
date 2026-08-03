import { describe, expect, it } from "vitest";

import type { FuturesBasisParams, FuturesStandardParams } from "../../api/futures/params.ts";
import type { OptionsParams } from "../../api/options/params.ts";
import type { SpotParams } from "../../api/spot/params.ts";

const range = {
  begin: 1_767_225_600_000,
  end: 1_767_268_800_000,
  resolution: "1m",
} as const;

const futures: FuturesStandardParams<"close_price" | "funding_rate"> = {
  ...range,
  exchanges: ["binance-futures"],
  products: ["BTCUSDT"],
  columns: ["close_price", "funding_rate"],
};

const basis: FuturesBasisParams = {
  ...range,
  columns: ["3m_basis_ann"],
  coins: ["BTC", "ETH"],
};

const spot: SpotParams<"close_price"> = {
  ...range,
  exchanges: ["coinbase"],
  coins: ["BTC"],
  columns: ["close_price"],
};

const options: OptionsParams<"iv_1m"> = {
  ...range,
  exchanges: ["deribit"],
  coins: ["BTC"],
  columns: ["iv_1m"],
};

// @ts-expect-error products and coins are mutually exclusive
const both: SpotParams = {
  ...spot,
  products: ["BTC-USD"],
};

const wrongSpotColumn: SpotParams = {
  ...spot,
  // @ts-expect-error funding_rate is a futures column
  columns: ["funding_rate"],
};

const wrongOptionsExchange: OptionsParams = {
  ...options,
  // @ts-expect-error coinbase is a spot exchange
  exchanges: ["coinbase"],
};

describe("market rows parameter types", () => {
  it("preserves market-specific selections", () => {
    expect(futures.columns).toEqual(["close_price", "funding_rate"]);
    expect(basis.coins).toEqual(["BTC", "ETH"]);
    expect(spot.exchanges).toEqual(["coinbase"]);
    expect(options.columns).toEqual(["iv_1m"]);
    expect([both, wrongSpotColumn, wrongOptionsExchange]).toBeDefined();
  });
});
