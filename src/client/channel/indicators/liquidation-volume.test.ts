import { describe, expect, expectTypeOf, it } from "vitest";

import { channel } from "../../../index.ts";
import type { FuturesLiquidationVolumeColumn } from "../../api/futures/selectors.ts";
import type { Row } from "../../data/row.ts";
import type { FuturesExchange } from "../../market/exchanges.ts";
import type { Channel } from "../channel.ts";
import type { ExchangeEntry } from "../helpers/decode.ts";

const BTC = { exchange: "binance-futures", coin: "BTC", product: "BTCUSDT" } as const;
const COINS = "realtime_binance-futures:BTCUSDT#liquidations#Coins";
const DOLLARS = "realtime_binance-futures:BTCUSDT#liquidations#Dollars";
const AGGREGATE_DOLLARS = "realtime_BTC#liquidations#Dollars#Aggregated";

/* Frames captured live on 2026-09-21 around the 09:03:00 UTC rollover. */
const LAST_OF_MINUTE = { c: COINS, d: [1.173, 0], f: false, tt: 1789981379999 };
const ROLLOVER = { c: COINS, d: [0, 0], f: true, tt: 1789981380004 };
const DOLLARS_LAST_OF_MINUTE = { c: DOLLARS, d: [98423.653, 0], f: false, tt: 1789981379999 };
/*
 * The last frame of the same minute. BTC trades on eight futures exchanges;
 * these five are the ones that publish live liquidations.
 */
const AGGREGATE_FRAME = {
  c: AGGREGATE_DOLLARS,
  tt: 1789981379999,
  f: false,
  d: {
    "realtime_okex-swap": [24810.56301, 0],
    "realtime_binance-futures": [98423.653, 0],
    realtime_hyperliquid: [80697.59999999999, 0],
    realtime_bybit: [24416.882500000003, 0],
    realtime_deribit: [0, 0],
  },
};

describe("channel.liquidationVolume", () => {
  it("names one channel per metric and target, defaulting to dollars as history does", () => {
    const named = (built: { readonly kind: string; readonly name: string }) => [
      built.kind,
      built.name,
    ];

    expect(named(channel.liquidationVolume(BTC))).toEqual(["liquidation_volume_dollars", DOLLARS]);
    expect(named(channel.liquidationVolume(BTC, { metric: "coins" }))).toEqual([
      "liquidation_volume_coins",
      COINS,
    ]);
    expect(named(channel.liquidationVolume({ coin: "BTC" }))).toEqual([
      "aggregated_liquidation_volume_dollars",
      AGGREGATE_DOLLARS,
    ]);
    expect(named(channel.liquidationVolume({ coin: "BTC" }, { metric: "coins" }))).toEqual([
      "aggregated_liquidation_volume_coins",
      "realtime_BTC#liquidations#Coins#Aggregated",
    ]);
  });

  it("types each channel in history's buy and sell columns of its metric", () => {
    expectTypeOf(channel.liquidationVolume(BTC)).toEqualTypeOf<
      Channel<
        "liquidation_volume_dollars",
        Row<FuturesExchange, FuturesLiquidationVolumeColumn<"dollar", "buy" | "sell">>
      >
    >();
    expectTypeOf(channel.liquidationVolume({ coin: "BTC" }, { metric: "coins" })).toEqualTypeOf<
      Channel<
        "aggregated_liquidation_volume_coins",
        readonly ExchangeEntry<
          FuturesExchange,
          FuturesLiquidationVolumeColumn<"coin", "buy" | "sell">
        >[]
      >
    >();
  });

  it("decodes a coin frame to the history row of its minute, and starts again at zero in the next", () => {
    const coins = channel.liquidationVolume(BTC, { metric: "coins" });

    /* These are the values /api/v1/rows returned for the same minute. */
    expect(coins.decode(LAST_OF_MINUTE)).toEqual({
      exchange: "binance-futures",
      coin: "BTC",
      product: "BTCUSDT",
      time: 1789981320000,
      buy_liquidations_coin_volume: 1.173,
      sell_liquidations_coin_volume: 0,
    });
    expect(coins.decode(ROLLOVER)).toEqual({
      exchange: "binance-futures",
      coin: "BTC",
      product: "BTCUSDT",
      time: 1789981380000,
      buy_liquidations_coin_volume: 0,
      sell_liquidations_coin_volume: 0,
    });
  });

  it("decodes a dollar frame to the dollar columns", () => {
    /* These too are the values /api/v1/rows returned for the minute. */
    expect(channel.liquidationVolume(BTC).decode(DOLLARS_LAST_OF_MINUTE)).toEqual({
      exchange: "binance-futures",
      coin: "BTC",
      product: "BTCUSDT",
      time: 1789981320000,
      buy_liquidations_dollar_volume: 98423.653,
      sell_liquidations_dollar_volume: 0,
    });
  });

  it("decodes a coin's frame to one entry per exchange that publishes, without a time", () => {
    const entries = channel.liquidationVolume({ coin: "BTC" }).decode(AGGREGATE_FRAME);

    /* The three coin-margin exchanges publish no live liquidations, so they have no entry. */
    expect(entries).toHaveLength(5);
    expect(entries.find((entry) => entry.exchange === "hyperliquid")).toEqual({
      exchange: "hyperliquid",
      coin: "BTC",
      buy_liquidations_dollar_volume: 80697.59999999999,
      sell_liquidations_dollar_volume: 0,
    });
  });

  it("follows futures products only", () => {
    // @ts-expect-error a spot exchange has no liquidations
    expect(() => channel.liquidationVolume({ ...BTC, exchange: "binance" })).toThrow(
      'channel.liquidationVolume() received an invalid exchange "binance"',
    );
  });

  it("has one option, the metric, in the plural; history's spelling is refused", () => {
    // @ts-expect-error history says coin, a channel says coins
    expect(() => channel.liquidationVolume(BTC, { metric: "coin" })).toThrow(
      'channel.liquidationVolume() received an unknown metric "coin"; expected coins, dollars',
    );
    // @ts-expect-error the count is another builder, channel.liquidations
    expect(() => channel.liquidationVolume(BTC, { metric: "count" })).toThrow(
      'channel.liquidationVolume() received an unknown metric "count"; expected coins, dollars',
    );
  });
});
