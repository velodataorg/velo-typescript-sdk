import { describe, expect, it } from "vitest";

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
  ORDERBOOK_PATH,
  OrderbookData,
  RESOLUTIONS,
  SPOT_COLUMNS,
  SPOT_EXCHANGES,
  STATUS_PATH,
  TERMS_COINS,
  TERMS_COLUMNS,
  TERMS_PATH,
} from "./index.js";
import type { NewsWatcherEvents, NewsWatcherListener } from "./index.js";

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
});

describe("catalog public exports", () => {
  it("exports the options catalog path", () => {
    expect(OPTIONS_CATALOG_PATH).toBe("/api/v1/options");
  });
});

describe("terms public exports", () => {
  it("exports the endpoint contract", () => {
    expect(TERMS_PATH).toBe("/api/v1/terms");
    expect(TERMS_COINS).toEqual(["BTC", "ETH"]);
    expect(TERMS_COLUMNS).toEqual(["coin", "time", "at_the_money_iv", "dte", "fwd_iv"]);
  });
});

describe("status public exports", () => {
  it("exports the endpoint contract", () => {
    expect(STATUS_PATH).toBe("/api/v1/status");
  });
});

describe("orderbook public exports", () => {
  it("exports the endpoint contract and data view", () => {
    expect(ORDERBOOK_PATH).toBe("/api/l/levels");
    expect(new OrderbookData([]).snapshots()).toEqual([]);
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
});
