import { describe, expect, expectTypeOf, it } from "vitest";

import {
  CAPS_PATH,
  DEFAULT_NEWS_HEARTBEAT_TIMEOUT,
  FUTURES_COLUMNS,
  FUTURES_EXCHANGES,
  MARKET_CAPS_COLUMNS,
  OPTIONS_CATALOG_PATH,
  OPTIONS_COLUMNS,
  OPTIONS_EXCHANGES,
  RESOLUTIONS,
  SPOT_COLUMNS,
  SPOT_EXCHANGES,
  STATUS_PATH,
  TERMS_COINS,
  TERMS_COLUMNS,
  TERMS_PATH,
} from "./index.js";
import type {
  Exchange,
  FuturesBuilder,
  FuturesOpenInterestMetric,
  FuturesPricePart,
  FuturesRow,
  FuturesStandardParams,
  FutureProduct,
  LastDuration,
  MarketCap,
  MarketCapsParams,
  NewsStory,
  NewsWatcherEvents,
  NewsWatcherListener,
  OptionsParams,
  OptionProduct,
  SpotParams,
  SpotProduct,
  StatusResponse,
  TermPoint,
  TermsCoin,
  TermsParams,
} from "./index.js";

describe("market caps public exports", () => {
  it("exports the wire endpoint and renamed market-caps contract", () => {
    expect(CAPS_PATH).toBe("/api/v1/caps");
    expect(MARKET_CAPS_COLUMNS).toEqual([
      "coin",
      "time",
      "circ",
      "circ_dollars",
      "fdv",
      "fdv_dollars",
    ]);
    expectTypeOf<MarketCapsParams["coins"][number]>().toEqualTypeOf<string>();
    expectTypeOf<MarketCap["circ"]>().toEqualTypeOf<number | null>();
  });
});

describe("rows public exports", () => {
  it("exports market vocabularies and row metadata", () => {
    expect(FUTURES_EXCHANGES).toContain("binance-futures");
    expect(OPTIONS_EXCHANGES).toEqual(["deribit"]);
    expect(SPOT_EXCHANGES).toContain("coinbase");
    expect(FUTURES_COLUMNS).toContain("funding_rate");
    expect(OPTIONS_COLUMNS).toContain("iv_1m");
    expect(SPOT_COLUMNS).toContain("close_price");
    expect(RESOLUTIONS["1M"]).toEqual({ unit: "months", count: 1 });
  });

  it("exports market-specific parameter and inferred row types", () => {
    expectTypeOf<(typeof FUTURES_EXCHANGES)[number]>().toMatchTypeOf<Exchange>();
    expectTypeOf<(typeof OPTIONS_EXCHANGES)[number]>().toMatchTypeOf<Exchange>();
    expectTypeOf<(typeof SPOT_EXCHANGES)[number]>().toMatchTypeOf<Exchange>();
    expectTypeOf<FuturesStandardParams["exchanges"][number]>().toEqualTypeOf<
      (typeof FUTURES_EXCHANGES)[number]
    >();
    expectTypeOf<SpotParams["columns"][number]>().toEqualTypeOf<(typeof SPOT_COLUMNS)[number]>();
    expectTypeOf<OptionsParams["columns"][number]>().toEqualTypeOf<
      (typeof OPTIONS_COLUMNS)[number]
    >();
    expectTypeOf<FuturesRow<"close_price">["close_price"]>().toEqualTypeOf<number | null>();
    expectTypeOf<FuturesPricePart>().toEqualTypeOf<"open" | "high" | "low" | "close">();
    expectTypeOf<FuturesOpenInterestMetric>().toEqualTypeOf<"coin" | "dollar">();
    expectTypeOf<"11m">().toMatchTypeOf<LastDuration>();
    expectTypeOf<
      ReturnType<FuturesBuilder<"open_price">["params"]>["columns"][number]
    >().toEqualTypeOf<"open_price">();
  });
});

describe("catalog public exports", () => {
  it("exports the options catalog path and product types", () => {
    expect(OPTIONS_CATALOG_PATH).toBe("/api/v1/options");
    expectTypeOf<FutureProduct["depth"]>().toEqualTypeOf<boolean>();
    expectTypeOf<FutureProduct["end"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<SpotProduct["exchange"]>().toEqualTypeOf<(typeof SPOT_EXCHANGES)[number]>();
    expectTypeOf<SpotProduct["end"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<OptionProduct["exchange"]>().toEqualTypeOf<(typeof OPTIONS_EXCHANGES)[number]>();
  });
});

describe("terms public exports", () => {
  it("exports the endpoint contract and inferred result types", () => {
    expect(TERMS_PATH).toBe("/api/v1/terms");
    expect(TERMS_COINS).toEqual(["BTC", "ETH"]);
    expect(TERMS_COLUMNS).toEqual(["coin", "time", "at_the_money_iv", "dte", "fwd_iv"]);
    expectTypeOf<TermsParams["coins"][number]>().toEqualTypeOf<TermsCoin>();
    expectTypeOf<TermPoint["coin"]>().toEqualTypeOf<TermsCoin>();
    expectTypeOf<TermPoint["fwd_iv"]>().toEqualTypeOf<number | null>();
  });
});

describe("status public exports", () => {
  it("exports the endpoint contract", () => {
    expect(STATUS_PATH).toBe("/api/v1/status");
    expectTypeOf<StatusResponse>().toEqualTypeOf<"ok">();
  });
});

describe("news public exports", () => {
  it("exports watcher constants and typed events", () => {
    expect(DEFAULT_NEWS_HEARTBEAT_TIMEOUT).toBe(300_000);

    const listener: NewsWatcherListener<"delete"> = (event) => {
      const id: number = event.id;
      expect(id).toBe(1);
    };
    const event: NewsWatcherEvents["delete"] = { id: 1 };
    listener(event);
  });

  it("exports the validated story type", () => {
    expectTypeOf<NewsStory["effectivePrice"]>().toEqualTypeOf<number | null>();
    expectTypeOf<NewsStory["coins"]>().toEqualTypeOf<string[]>();
  });
});
