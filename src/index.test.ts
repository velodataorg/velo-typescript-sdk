import { describe, expect, expectTypeOf, it } from "vitest";

import {
  DEFAULT_NEWS_HEARTBEAT_TIMEOUT,
  EXCHANGES,
  FUTURES_CATALOG_PATH,
  FUTURES_COLUMNS,
  NEWS_PATH,
  NEWS_WEBSOCKET_PATH,
  SPOT_CATALOG_PATH,
  VeloError,
  VeloRateLimitError,
} from "./index.js";
import type {
  Catalog,
  CatalogParams,
  Exchange,
  FutureProduct,
  FuturesExchange,
  NewsWatcherEvents,
  NewsWatcherListener,
  SpotProduct,
  SpotExchange,
  WebSocketFactory,
} from "./index.js";

describe("public entry", () => {
  it("exports API constants", () => {
    expect(EXCHANGES).toContain("binance-futures");
    expect(FUTURES_COLUMNS).toContain("funding_rate");
    expect(FUTURES_CATALOG_PATH).toBe("/api/v1/futures");
    expect(SPOT_CATALOG_PATH).toBe("/api/v1/spot");
    expect(NEWS_PATH).toBe("/api/n/news");
    expect(NEWS_WEBSOCKET_PATH).toBe("/api/w/connect");
    expect(DEFAULT_NEWS_HEARTBEAT_TIMEOUT).toBe(300_000);
  });

  it("exports the error hierarchy", () => {
    expect(new VeloRateLimitError("x")).toBeInstanceOf(VeloError);
  });

  it("accepts a native WebSocket as a custom factory", () => {
    const factory: WebSocketFactory = (target) => new WebSocket(target.authenticatedUrl);
    expect(factory).toBeTypeOf("function");
  });

  it("exports the typed News watcher event map", () => {
    const listener: NewsWatcherListener<"delete"> = (event) => {
      const id: number = event.id;
      expect(id).toBe(1);
    };
    const event: NewsWatcherEvents["delete"] = { id: 1 };
    listener(event);
  });

  it("exports the catalog result and mutually exclusive search types", () => {
    expectTypeOf<FutureProduct["exchange"]>().toEqualTypeOf<FuturesExchange>();
    expectTypeOf<SpotProduct["exchange"]>().toEqualTypeOf<SpotExchange>();
    expectTypeOf<FutureProduct["depth"]>().toEqualTypeOf<boolean>();
    expectTypeOf<CatalogParams["exchange"]>().toEqualTypeOf<Exchange | undefined>();
    expectTypeOf<Parameters<Catalog["futures"]>[0]>().toEqualTypeOf<
      CatalogParams<FuturesExchange> | undefined
    >();
    expectTypeOf<Parameters<Catalog["spot"]>[0]>().toEqualTypeOf<
      CatalogParams<SpotExchange> | undefined
    >();

    const searches: CatalogParams[] = [
      {},
      { coin: "BTC" },
      { product: "BTCUSDT" },
      { product: "BTCUSDT", exchange: "binance-futures" },
    ];
    expect(searches).toHaveLength(4);
  });
});
