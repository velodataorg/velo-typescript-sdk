import { describe, expect, expectTypeOf, it } from "vitest";

import { channel } from "../../../index.ts";
import type { FuturesVolumeColumn } from "../../api/futures/selectors.ts";
import type { Row } from "../../data/row.ts";
import type { FuturesExchange } from "../../market/exchanges.ts";
import type { Channel } from "../channel.ts";
import type { ExchangeEntry } from "../helpers/decode.ts";

const BTC = { exchange: "binance-futures", coin: "BTC", product: "BTCUSDT" } as const;
const COINS = "realtime_binance-futures:BTCUSDT#volume#Coins";
const DOLLARS = "realtime_binance-futures:BTCUSDT#volume#Dollars";
const AGGREGATE_COINS = "realtime_BTC#volume#Coins#Aggregated";

/* Frames captured live on 2026-09-21 around the 08:34:00 UTC rollover. */
const LAST_OF_MINUTE = {
  c: COINS,
  d: [752.2859999999057, 705.0659999999253],
  f: false,
  tt: 1789979639999,
};
const ROLLOVER = {
  c: COINS,
  d: [0.12, 1.995],
  f: true,
  tt: 1789979640247,
};
const DOLLARS_LAST_OF_MINUTE = {
  c: DOLLARS,
  d: [62178506.13699985, 58256096.98599991],
  f: false,
  tt: 1789979639999,
};
/* Captured the same minute, 26 seconds in. */
const AGGREGATE_FRAME = {
  c: AGGREGATE_COINS,
  tt: 1789979586466,
  f: false,
  d: {
    realtime_hyperliquid: [55.51863999999996, 7.105740000000002],
    realtime_bybit: [53.2949999999998, 19.77600000000008],
    "realtime_binance-futures": [333.4239999999961, 130.43300000000306],
    "realtime_okex-swap": [104.05120000000173, 35.96070000000013],
    "realtime_okex-coin-margin": [8.469957108803678, 2.196571847078346],
    "realtime_binance-coin-margin": [170.89796533252584, 13.779205727683994],
    "realtime_bybit-coin-margin": [5.499453670734752, 0.2633261799204098],
    realtime_deribit: [34.55829547644468, 1.0508732467131314],
  },
};

describe("channel.volume", () => {
  it("names one channel per metric and target, defaulting to dollars as history does", () => {
    const named = (built: { readonly kind: string; readonly name: string }) => [
      built.kind,
      built.name,
    ];

    expect(named(channel.volume(BTC))).toEqual(["volume_dollars", DOLLARS]);
    expect(named(channel.volume(BTC, { metric: "dollars" }))).toEqual(["volume_dollars", DOLLARS]);
    expect(named(channel.volume(BTC, { metric: "coins" }))).toEqual(["volume_coins", COINS]);
    expect(named(channel.volume({ coin: "BTC" }))).toEqual([
      "aggregated_volume_dollars",
      "realtime_BTC#volume#Dollars#Aggregated",
    ]);
    expect(named(channel.volume({ coin: "BTC" }, { metric: "coins" }))).toEqual([
      "aggregated_volume_coins",
      AGGREGATE_COINS,
    ]);
  });

  it("types each channel in history's buy and sell columns of its metric", () => {
    expectTypeOf(channel.volume(BTC)).toEqualTypeOf<
      Channel<"volume_dollars", Row<FuturesExchange, FuturesVolumeColumn<"dollar", "buy" | "sell">>>
    >();
    expectTypeOf(channel.volume(BTC, { metric: "coins" })).toEqualTypeOf<
      Channel<"volume_coins", Row<FuturesExchange, FuturesVolumeColumn<"coin", "buy" | "sell">>>
    >();
    expectTypeOf(channel.volume({ coin: "BTC" }, { metric: "coins" })).toEqualTypeOf<
      Channel<
        "aggregated_volume_coins",
        readonly ExchangeEntry<FuturesExchange, FuturesVolumeColumn<"coin", "buy" | "sell">>[]
      >
    >();
  });

  it("decodes a coin frame to the history row of its minute, and starts again in the next", () => {
    const coins = channel.volume(BTC, { metric: "coins" });

    /* These are the values /api/v1/rows returned for the same minute. */
    expect(coins.decode(LAST_OF_MINUTE)).toEqual({
      exchange: "binance-futures",
      coin: "BTC",
      product: "BTCUSDT",
      time: 1789979580000,
      buy_coin_volume: 752.2859999999057,
      sell_coin_volume: 705.0659999999253,
    });
    /* Unlike open interest, the new candle is not seeded: it holds the new minute's trades only. */
    expect(coins.decode(ROLLOVER)).toEqual({
      exchange: "binance-futures",
      coin: "BTC",
      product: "BTCUSDT",
      time: 1789979640000,
      buy_coin_volume: 0.12,
      sell_coin_volume: 1.995,
    });
  });

  it("decodes a dollar frame to the dollar columns", () => {
    /* These too are the values /api/v1/rows returned for the minute. */
    expect(channel.volume(BTC).decode(DOLLARS_LAST_OF_MINUTE)).toEqual({
      exchange: "binance-futures",
      coin: "BTC",
      product: "BTCUSDT",
      time: 1789979580000,
      buy_dollar_volume: 62178506.13699985,
      sell_dollar_volume: 58256096.98599991,
    });
  });

  it("decodes a coin's frame to one entry per exchange, in the product columns, without a time", () => {
    const entries = channel.volume({ coin: "BTC" }, { metric: "coins" }).decode(AGGREGATE_FRAME);

    expect(entries).toHaveLength(8);
    expect(entries.find((entry) => entry.exchange === "bybit")).toEqual({
      exchange: "bybit",
      coin: "BTC",
      buy_coin_volume: 53.2949999999998,
      sell_coin_volume: 19.77600000000008,
    });
  });

  it("follows futures products only", () => {
    // @ts-expect-error spot volume is another channel
    expect(() => channel.volume({ ...BTC, exchange: "binance" })).toThrow(
      'channel.volume() received an invalid exchange "binance"',
    );
  });

  it("has one option, the metric, in the plural; history's spelling is refused", () => {
    // @ts-expect-error history says coin, a channel says coins
    expect(() => channel.volume(BTC, { metric: "coin" })).toThrow(
      'channel.volume() received an unknown metric "coin"; expected coins, dollars',
    );
    // @ts-expect-error total is a part of history's volume, not an option here
    expect(() => channel.volume(BTC, { parts: ["total"] })).toThrow(
      'channel.volume() received an unknown option "parts"; expected metric',
    );
  });
});
