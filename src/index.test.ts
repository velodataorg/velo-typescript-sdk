import { describe, expect, expectTypeOf, it } from "vitest";

import {
  CAPS_PATH,
  DEFAULT_NEWS_CONNECT_TIMEOUT,
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
  FuturesBasisBuilder,
  FuturesBuilder,
  FuturesFundingRatePart,
  FuturesLiquidationPart,
  FuturesLiquidationVolumeMetric,
  FuturesLiquidationVolumePart,
  FuturesOpenInterestMetric,
  FuturesOpenInterestPart,
  FuturesPricePart,
  FuturesRow,
  FuturesStandardParams,
  FuturesTradePart,
  FuturesVolumeMetric,
  FuturesVolumePart,
  FutureProduct,
  LastDuration,
  MarketCap,
  MarketCapsParams,
  NewsStory,
  NewsWatcherEvents,
  NewsWatcherListener,
  OptionsBuilder,
  OptionsDeltaMetric,
  OptionsDeltaPart,
  OptionsDvolPart,
  OptionsGammaMetric,
  OptionsIvTenor,
  OptionsNotionalPart,
  OptionsParams,
  OptionsPremiumPart,
  OptionsSkewTenor,
  OptionsVegaMetric,
  OptionsVolumePart,
  OptionProduct,
  SpotParams,
  SpotBuilder,
  SpotPricePart,
  SpotProduct,
  SpotTradePart,
  SpotVolumeMetric,
  SpotVolumePart,
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
    expectTypeOf<
      ReturnType<SpotBuilder<"open_price">["params"]>["columns"][number]
    >().toEqualTypeOf<"open_price">();
    expectTypeOf<OptionsParams["columns"][number]>().toEqualTypeOf<
      (typeof OPTIONS_COLUMNS)[number]
    >();
    expectTypeOf<
      ReturnType<OptionsBuilder<"iv_1m">["params"]>["columns"][number]
    >().toEqualTypeOf<"iv_1m">();
    expectTypeOf<FuturesRow<"close_price">["close_price"]>().toEqualTypeOf<number | null>();
    expectTypeOf<"11m">().toMatchTypeOf<LastDuration>();
    expectTypeOf<
      ReturnType<FuturesBuilder<"open_price">["params"]>["columns"][number]
    >().toEqualTypeOf<"open_price">();
    expectTypeOf<ReturnType<FuturesBasisBuilder["params"]>["columns"]>().toEqualTypeOf<
      readonly ["3m_basis_ann"]
    >();
  });

  it("exports futures fluent selector vocabularies", () => {
    expectTypeOf<FuturesPricePart>().toEqualTypeOf<"open" | "high" | "low" | "close">();
    expectTypeOf<FuturesVolumeMetric>().toEqualTypeOf<"coin" | "dollar">();
    expectTypeOf<FuturesVolumePart>().toEqualTypeOf<"total" | "buy" | "sell">();
    expectTypeOf<FuturesTradePart>().toEqualTypeOf<"buy" | "sell" | "total">();
    expectTypeOf<FuturesOpenInterestMetric>().toEqualTypeOf<"coin" | "dollar">();
    expectTypeOf<FuturesOpenInterestPart>().toEqualTypeOf<"high" | "low" | "close">();
    expectTypeOf<FuturesFundingRatePart>().toEqualTypeOf<"rate" | "average">();
    expectTypeOf<FuturesLiquidationPart>().toEqualTypeOf<"buy" | "sell">();
    expectTypeOf<FuturesLiquidationVolumeMetric>().toEqualTypeOf<"coin" | "dollar">();
    expectTypeOf<FuturesLiquidationVolumePart>().toEqualTypeOf<"buy" | "sell" | "total">();
  });

  it("exports spot fluent selector vocabularies", () => {
    expectTypeOf<SpotPricePart>().toEqualTypeOf<"open" | "high" | "low" | "close">();
    expectTypeOf<SpotVolumeMetric>().toEqualTypeOf<"coin" | "dollar">();
    expectTypeOf<SpotVolumePart>().toEqualTypeOf<"total" | "buy" | "sell">();
    expectTypeOf<SpotTradePart>().toEqualTypeOf<"buy" | "sell" | "total">();
  });

  it("exports options fluent selector vocabularies", () => {
    expectTypeOf<OptionsIvTenor>().toEqualTypeOf<"1w" | "1m" | "3m" | "6m">();
    expectTypeOf<OptionsSkewTenor>().toEqualTypeOf<"1w" | "1m" | "3m" | "6m">();
    expectTypeOf<OptionsVegaMetric>().toEqualTypeOf<"coin" | "dollar">();
    expectTypeOf<OptionsDeltaMetric>().toEqualTypeOf<"coin" | "dollar">();
    expectTypeOf<OptionsDeltaPart>().toEqualTypeOf<"call" | "put">();
    expectTypeOf<OptionsGammaMetric>().toEqualTypeOf<"coin" | "dollar">();
    expectTypeOf<OptionsVolumePart>().toEqualTypeOf<"call" | "put">();
    expectTypeOf<OptionsPremiumPart>().toEqualTypeOf<"call" | "put">();
    expectTypeOf<OptionsNotionalPart>().toEqualTypeOf<"call" | "put">();
    expectTypeOf<OptionsDvolPart>().toEqualTypeOf<"open" | "high" | "low" | "close">();
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
    expect(DEFAULT_NEWS_CONNECT_TIMEOUT).toBe(30_000);

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
