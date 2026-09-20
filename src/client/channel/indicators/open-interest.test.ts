import { describe, expect, expectTypeOf, it } from "vitest";

import { channel } from "../../../index.ts";
import type { FuturesOpenInterestColumn } from "../../api/futures/selectors.ts";
import type { Row } from "../../data/row.ts";
import type { FuturesExchange } from "../../market/exchanges.ts";
import type { Channel } from "../channel.ts";
import type { ExchangeEntry } from "../helpers/decode.ts";

const BTC = { exchange: "binance-futures", coin: "BTC", product: "BTCUSDT" } as const;
const COINS = "realtime_binance-futures:BTCUSDT#open_interest#Coins";
const DOLLARS = "realtime_binance-futures:BTCUSDT#open_interest#Dollars";
const AGGREGATE_COINS = "realtime_BTC#open_interest#Coins#Aggregated";

/* Frames captured live on 2026-09-18 around the 08:41:00 UTC rollover. */
const LAST_OF_MINUTE = {
  c: COINS,
  d: [108224.37, 108212.476, 108224.08],
  f: false,
  tt: 1789720859999,
};
const ROLLOVER = {
  c: COINS,
  d: [108224.08, 108224.08, 108224.08],
  f: true,
  tt: 1789720860000,
};
/*
 * The last dollar payload of the 09:00:00 UTC minute, captured the same day.
 * Its tick time was not recorded; any instant inside the minute decodes alike.
 */
const DOLLARS_LAST_OF_MINUTE = {
  c: DOLLARS,
  d: [8448574682.641, 8442044698.981, 8445349240.2669],
  tt: 1789722059999,
};
/* Captured live on 2026-09-18, the last frame stamped inside the 08:40 UTC minute. */
const AGGREGATE_FRAME = {
  c: AGGREGATE_COINS,
  tt: 1789720859999,
  f: false,
  d: {
    "realtime_okex-coin-margin": [6472.295509088199, 6472.287193928873, 6472.295509088199],
    realtime_deribit: [10047.403354814322, 10047.393033880415, 10047.403354814322],
    realtime_hyperliquid: [35795.213, 35792.9317, 35792.9317],
    "realtime_binance-coin-margin": [16092.303580904072, 16091.571898856373, 16092.29330239502],
    "realtime_bybit-coin-margin": [6040.641720850145, 6040.641720850145, 6040.641720850145],
    realtime_bybit: [56289.734, 56283.748, 56284.329],
    "realtime_binance-futures": [108224.08, 108224.08, 108224.08],
    "realtime_okex-swap": [28585.509100000178, 28585.509100000178, 28585.509100000178],
  },
};

describe("channel.openInterest", () => {
  it("names one channel per metric and target, defaulting to dollars as history does", () => {
    const named = (built: { readonly kind: string; readonly name: string }) => [
      built.kind,
      built.name,
    ];

    expect(named(channel.openInterest(BTC))).toEqual(["open_interest_dollars", DOLLARS]);
    expect(named(channel.openInterest(BTC, { metric: "dollars" }))).toEqual([
      "open_interest_dollars",
      DOLLARS,
    ]);
    expect(named(channel.openInterest(BTC, { metric: "coins" }))).toEqual([
      "open_interest_coins",
      COINS,
    ]);
    expect(named(channel.openInterest({ coin: "BTC" }))).toEqual([
      "aggregated_open_interest_dollars",
      "realtime_BTC#open_interest#Dollars#Aggregated",
    ]);
    expect(named(channel.openInterest({ coin: "BTC" }, { metric: "coins" }))).toEqual([
      "aggregated_open_interest_coins",
      AGGREGATE_COINS,
    ]);
  });

  it("types each channel in the history columns of its metric", () => {
    expectTypeOf(channel.openInterest(BTC)).toEqualTypeOf<
      Channel<"open_interest_dollars", Row<FuturesExchange, FuturesOpenInterestColumn<"dollar">>>
    >();
    expectTypeOf(channel.openInterest(BTC, { metric: "coins" })).toEqualTypeOf<
      Channel<"open_interest_coins", Row<FuturesExchange, FuturesOpenInterestColumn<"coin">>>
    >();
    expectTypeOf(channel.openInterest({ coin: "BTC" }, { metric: "coins" })).toEqualTypeOf<
      Channel<
        "aggregated_open_interest_coins",
        readonly ExchangeEntry<FuturesExchange, FuturesOpenInterestColumn<"coin">>[]
      >
    >();
  });

  it("decodes a coin frame to the history row of its minute", () => {
    const coins = channel.openInterest(BTC, { metric: "coins" });

    /* These are the values /api/v1/rows returned for the same minute. */
    expect(coins.decode(LAST_OF_MINUTE)).toEqual({
      exchange: "binance-futures",
      coin: "BTC",
      product: "BTCUSDT",
      time: 1789720800000,
      coin_open_interest_high: 108224.37,
      coin_open_interest_low: 108212.476,
      coin_open_interest_close: 108224.08,
    });
    /* The new candle opens at the previous close. */
    expect(coins.decode(ROLLOVER)).toEqual({
      exchange: "binance-futures",
      coin: "BTC",
      product: "BTCUSDT",
      time: 1789720860000,
      coin_open_interest_high: 108224.08,
      coin_open_interest_low: 108224.08,
      coin_open_interest_close: 108224.08,
    });
  });

  it("decodes a dollar frame to the dollar columns, close valued at the last trade", () => {
    const row = channel.openInterest(BTC).decode(DOLLARS_LAST_OF_MINUTE);

    expect(row).toEqual({
      exchange: "binance-futures",
      coin: "BTC",
      product: "BTCUSDT",
      time: 1789722000000,
      dollar_open_interest_high: 8448574682.641,
      dollar_open_interest_low: 8442044698.981,
      dollar_open_interest_close: 8445349240.2669,
    });
    /*
     * /api/v1/rows returned the same high and low for that minute but a close
     * of 8446523511.398, valued at the mark price of the last update instead.
     */
    expect(row.dollar_open_interest_close).not.toBe(8446523511.398);
  });

  it("decodes a coin's frame to one entry per exchange, in the product columns, without a time", () => {
    const entries = channel
      .openInterest({ coin: "BTC" }, { metric: "coins" })
      .decode(AGGREGATE_FRAME);

    expect(entries).toHaveLength(8);
    expect(entries.find((entry) => entry.exchange === "bybit")).toEqual({
      exchange: "bybit",
      coin: "BTC",
      coin_open_interest_high: 56289.734,
      coin_open_interest_low: 56283.748,
      coin_open_interest_close: 56284.329,
    });
    /* Close is each exchange's current value, so the total is exact. */
    const total = entries.reduce((sum, entry) => sum + (entry.coin_open_interest_close ?? 0), 0);
    expect(total).toBeCloseTo(267539.4837, 4);
  });

  it("follows futures products only", () => {
    // @ts-expect-error a spot exchange publishes no open interest
    expect(() => channel.openInterest({ ...BTC, exchange: "binance" })).toThrow(
      'channel.openInterest() received an invalid exchange "binance"',
    );
  });

  it("has one option, the metric, in the plural; history's spelling is refused", () => {
    // @ts-expect-error contracts is not a metric
    expect(() => channel.openInterest(BTC, { metric: "contracts" })).toThrow(
      'channel.openInterest() received an unknown metric "contracts"; expected coins, dollars',
    );
    // @ts-expect-error history says coin, a channel says coins
    expect(() => channel.openInterest(BTC, { metric: "coin" })).toThrow(
      'channel.openInterest() received an unknown metric "coin"; expected coins, dollars',
    );
    // @ts-expect-error the target says what to follow; no option does
    expect(() => channel.openInterest(BTC, { aggregated: true })).toThrow(
      'channel.openInterest() received an unknown option "aggregated"; expected metric',
    );
  });
});
