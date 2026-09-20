import { describe, expect, it } from "vitest";

import { VeloError } from "../../../errors.ts";
import { entryExchange, renderAggregatedName, renderSingleName } from "./render.ts";

describe("rendering a channel name", () => {
  it("renders a single channel's name from its exchange, its symbol, and the words", () => {
    const product = { exchange: "binance-futures", product: "BTCUSDT" };
    expect(renderSingleName(product, [])).toBe("realtime_binance-futures:BTCUSDT");
    expect(renderSingleName(product, ["open_interest", "Coins"])).toBe(
      "realtime_binance-futures:BTCUSDT#open_interest#Coins",
    );
    /* Words are the server's own, spaces and symbols included. */
    expect(renderSingleName(product, ["funding_rate", "Total Spend Rate ($)"])).toBe(
      "realtime_binance-futures:BTCUSDT#funding_rate#Total Spend Rate ($)",
    );
    /* A namespaced symbol keeps its own colon. */
    expect(renderSingleName({ exchange: "hyperliquid", product: "xyz:AAPL" }, [])).toBe(
      "realtime_hyperliquid:xyz:AAPL",
    );
  });

  it("renders an aggregated channel's name with the marker last, whatever the words", () => {
    expect(renderAggregatedName("BTC", ["open_interest", "Coins"])).toBe(
      "realtime_BTC#open_interest#Coins#Aggregated",
    );
    expect(renderAggregatedName("BTC", ["funding_rate", "Rate (%)", "weighted"])).toBe(
      "realtime_BTC#funding_rate#Rate (%)#weighted#Aggregated",
    );
    expect(renderAggregatedName("币安人生", ["premium"])).toBe(
      "realtime_币安人生#premium#Aggregated",
    );
  });

  it("names a product by its exchange and symbol alone, though it carries a coin too", () => {
    const product = { exchange: "bybit", product: "BTCUSDT", coin: "BTC" };
    expect(renderSingleName(product, ["premium"])).toBe("realtime_bybit:BTCUSDT#premium");
  });

  it.each([
    [{ exchange: "", product: "BTCUSDT" }, []],
    [{ exchange: "bybit", product: "" }, []],
    [{ exchange: "bybit", product: "BTCUSDT" }, [""]],
    [{ exchange: "bybit", product: "BTCUSDT" }, ["open_interest#Coins"]],
    [{ exchange: "bybit", product: `BTC${String.fromCharCode(0)}USDT` }, []],
  ])("rejects a single name that cannot be rendered: %j %j", (product, words) => {
    expect(() => renderSingleName(product, words)).toThrow(VeloError);
  });

  it.each([
    ["", []],
    ["BTC", [""]],
    ["BTC", ["open_interest#Coins"]],
    ["BTC\n", []],
    [42, []],
  ])("rejects an aggregated name that cannot be rendered: %j %j", (coin, words) => {
    expect(() => renderAggregatedName(coin as never, words)).toThrow(VeloError);
  });

  it("reads an exchange out of an aggregated frame's key", () => {
    expect(entryExchange("realtime_binance-futures")).toBe("binance-futures");
    expect(entryExchange("realtime_okex-coin-margin")).toBe("okex-coin-margin");
    expect(entryExchange("binance-futures")).toBe("binance-futures");
  });
});
