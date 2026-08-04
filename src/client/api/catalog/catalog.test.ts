import { describe, expect, it } from "vitest";

import { Velo } from "../../client.ts";
import type { FuturesCatalogParams } from "./futures.ts";
import type { OptionsCatalogParams } from "./options.ts";
import type { SpotCatalogParams } from "./spot.ts";

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

const validDepthFuturesSearch: FuturesCatalogParams = {
  coin: "BTC",
  exchange: "hyperliquid",
  depth: true,
};
void validDepthFuturesSearch;

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

// @ts-expect-error spot products do not track depth coverage
const invalidSpotDepth: SpotCatalogParams = { depth: true };
void invalidSpotDepth;

// @ts-expect-error options products do not track depth coverage
const invalidOptionsDepth: OptionsCatalogParams = { depth: true };
void invalidOptionsDepth;

describe("Velo.catalog", () => {
  it("exposes one stable catalog namespace", () => {
    const velo = new Velo({
      apiKey: "test_key",
      fetch: async () => new Response(""),
    });

    expect(velo.catalog).toBe(velo.catalog);
  });
});
