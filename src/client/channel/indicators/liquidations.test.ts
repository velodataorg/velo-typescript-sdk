import { describe, expect, expectTypeOf, it } from "vitest";

import { channels } from "../../../index.ts";
import type { FuturesLiquidationColumn } from "../../api/futures/selectors.ts";
import type { Row } from "../../data/row.ts";
import type { FuturesExchange } from "../../market/exchanges.ts";
import type { Channel } from "../channel.ts";
import type { ExchangeEntry } from "../helpers/decode.ts";

const BTC = { exchange: "binance-futures", coin: "BTC", product: "BTCUSDT" } as const;
const SINGLE = "realtime_binance-futures:BTCUSDT#liquidations#Liquidation Count";
const AGGREGATE = "realtime_BTC#liquidations#Liquidation Count#Aggregated";

/* Frames captured live on 2026-09-21 around the 09:03:00 UTC rollover. */
const LAST_OF_MINUTE = { c: SINGLE, d: [7, 0], f: false, tt: 1789981379999 };
const ROLLOVER = { c: SINGLE, d: [0, 0], f: true, tt: 1789981380004 };
/*
 * The last frame of the same minute. BTC trades on eight futures exchanges;
 * these five are the ones that publish live liquidations.
 */
const AGGREGATE_FRAME = {
  c: AGGREGATE,
  tt: 1789981379999,
  f: false,
  d: {
    "realtime_okex-swap": [6, 0],
    "realtime_binance-futures": [7, 0],
    realtime_hyperliquid: [1, 0],
    realtime_bybit: [9, 0],
    realtime_deribit: [0, 0],
  },
};

describe("channels.liquidations", () => {
  it("names one channel per target", () => {
    const single = channels.liquidations(BTC);
    const aggregated = channels.liquidations({ coin: "BTC" });

    expect([single.kind, single.name]).toEqual(["liquidations", SINGLE]);
    expect([aggregated.kind, aggregated.name]).toEqual(["aggregated_liquidations", AGGREGATE]);
  });

  it("types each channel in history's liquidation count columns", () => {
    expectTypeOf(channels.liquidations(BTC)).toEqualTypeOf<
      Channel<"liquidations", Row<FuturesExchange, FuturesLiquidationColumn>>
    >();
    expectTypeOf(channels.liquidations({ coin: "BTC" })).toEqualTypeOf<
      Channel<
        "aggregated_liquidations",
        readonly ExchangeEntry<FuturesExchange, FuturesLiquidationColumn>[]
      >
    >();
  });

  it("decodes a frame to the history row of its minute, and starts again at zero in the next", () => {
    /* These are the values /api/v1/rows returned for the same minute. */
    expect(channels.liquidations(BTC).decode(LAST_OF_MINUTE)).toEqual({
      exchange: "binance-futures",
      coin: "BTC",
      product: "BTCUSDT",
      time: 1789981320000,
      buy_liquidations: 7,
      sell_liquidations: 0,
    });
    expect(channels.liquidations(BTC).decode(ROLLOVER)).toEqual({
      exchange: "binance-futures",
      coin: "BTC",
      product: "BTCUSDT",
      time: 1789981380000,
      buy_liquidations: 0,
      sell_liquidations: 0,
    });
  });

  it("decodes a coin's frame to one entry per exchange that publishes, without a time", () => {
    const entries = channels.liquidations({ coin: "BTC" }).decode(AGGREGATE_FRAME);

    /* The three coin-margin exchanges publish no live liquidations, so they have no entry. */
    expect(entries.map((entry) => entry.exchange).toSorted()).toEqual([
      "binance-futures",
      "bybit",
      "deribit",
      "hyperliquid",
      "okex-swap",
    ]);
    expect(entries.find((entry) => entry.exchange === "bybit")).toEqual({
      exchange: "bybit",
      coin: "BTC",
      buy_liquidations: 9,
      sell_liquidations: 0,
    });
  });

  it("follows futures products, the silent exchanges among them", () => {
    /* The server accepts this name and sends nothing for it; the docs say so. */
    expect(
      channels.liquidations({
        exchange: "binance-coin-margin",
        coin: "BTC",
        product: "BTCUSD_PERP",
      }).name,
    ).toBe("realtime_binance-coin-margin:BTCUSD_PERP#liquidations#Liquidation Count");
    // @ts-expect-error a spot exchange has no liquidations
    expect(() => channels.liquidations({ ...BTC, exchange: "binance" })).toThrow(
      'channels.liquidations() received an invalid exchange "binance"',
    );
  });
});
