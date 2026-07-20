import { describe, expect, expectTypeOf, it } from "vitest";

import {
  DEFAULT_NEWS_HEARTBEAT_TIMEOUT,
  FUTURES_COLUMNS,
  FUTURES_EXCHANGES,
  OPTIONS_COLUMNS,
  OPTIONS_EXCHANGES,
  RESOLUTIONS,
  ROWS_BASE_COLUMNS,
  SPOT_COLUMNS,
  SPOT_EXCHANGES,
} from "./index.js";
import type {
  FuturesRow,
  FuturesStandardParams,
  NewsStory,
  NewsWatcherEvents,
  NewsWatcherListener,
  OptionsParams,
  SpotParams,
} from "./index.js";

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
