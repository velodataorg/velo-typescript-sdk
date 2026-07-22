import { describe, expect, it } from "vitest";

import { Velo } from "../../client.js";
import type { FuturesCatalogParams } from "./futures-catalog-query.js";
import type { OptionsCatalogParams } from "./options-catalog-query.js";
import type { SpotCatalogParams } from "./spot-catalog-query.js";

const validFuturesSearches: FuturesCatalogParams[] = [
  {},
  { coin: "BTC" },
  { product: "BTCUSDT" },
  { exchange: "binance-futures" },
  { coin: "BTC", exchange: "hyperliquid" },
];
void validFuturesSearches;

const validDelistedFuturesSearch: FuturesCatalogParams = {
  product: "BTCUSDT",
  exchange: "binance-futures",
  delisted: true,
};
void validDelistedFuturesSearch;

const validDelistedSpotSearch: SpotCatalogParams = {
  coin: "BTC",
  exchange: "coinbase",
  delisted: true,
};
void validDelistedSpotSearch;

const validOptionsSearch: OptionsCatalogParams = { product: "BTC", exchange: "deribit" };
void validOptionsSearch;

// @ts-expect-error coin and product are mutually exclusive
const invalidSearch: FuturesCatalogParams = { coin: "BTC", product: "BTCUSDT" };
void invalidSearch;

// @ts-expect-error spot exchanges are not valid futures catalog filters
const invalidFuturesExchange: FuturesCatalogParams = { exchange: "coinbase" };
void invalidFuturesExchange;

// @ts-expect-error futures exchanges are not valid spot catalog filters
const invalidSpotExchange: SpotCatalogParams = { exchange: "binance-futures" };
void invalidSpotExchange;

// @ts-expect-error options do not expose a delisted catalog
const invalidOptionsDelisted: OptionsCatalogParams = { delisted: true };
void invalidOptionsDelisted;

describe("Velo.catalog", () => {
  it("exposes one stable catalog namespace", () => {
    const velo = new Velo({
      apiKey: "test_key",
      fetch: async () => new Response(""),
    });

    expect(velo.catalog).toBe(velo.catalog);
  });
});
