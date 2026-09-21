import { describe, expect, expectTypeOf, it } from "vitest";

import { channels } from "../../../index.ts";
import type { SpotVolumeColumn } from "../../api/spot/selectors.ts";
import type { Row } from "../../data/row.ts";
import type { SpotExchange } from "../../market/exchanges.ts";
import type { Channel } from "../channel.ts";
import type { ExchangeEntry } from "../helpers/decode.ts";

const BTC = { exchange: "coinbase", coin: "BTC", product: "BTC-USD" } as const;
const COINS = "realtime_coinbase:BTC-USD#spotvol#Coins";
const DOLLARS = "realtime_coinbase:BTC-USD#spotvol#Dollars";
const AGGREGATE_COINS = "realtime_BTC#spotvol#Coins#Aggregated";

/* Frames captured live on 2026-09-21 around the 08:48:00 UTC rollover. */
const LAST_OF_MINUTE = {
  c: COINS,
  d: [6.274340380000001, 6.488078499999996],
  f: false,
  tt: 1789980479999,
};
const ROLLOVER = { c: COINS, d: [0, 2e-8], f: true, tt: 1789980480162 };
const DOLLARS_LAST_OF_MINUTE = {
  c: DOLLARS,
  d: [524952.2199999997, 542597.0670000002],
  f: false,
  tt: 1789980479999,
};
/* Captured the same minute, 37 seconds in. */
const AGGREGATE_FRAME = {
  c: AGGREGATE_COINS,
  tt: 1789980456952,
  f: false,
  d: {
    realtime_binance: [18.89034000000017, 21.82867000000094],
    realtime_coinbase: [4.573965930000006, 4.173795370000001],
    realtime_okex: [10.695638450000022, 6.141713850000004],
    "realtime_bybit-spot": [7.459489000000012, 3.7395369999999937],
  },
};

describe("channels.spotVolume", () => {
  it("names one channel per metric and target, in the server's word for spot volume", () => {
    const named = (built: { readonly kind: string; readonly name: string }) => [
      built.kind,
      built.name,
    ];

    expect(named(channels.spotVolume(BTC))).toEqual(["spot_volume_dollars", DOLLARS]);
    expect(named(channels.spotVolume(BTC, { metric: "coins" }))).toEqual([
      "spot_volume_coins",
      COINS,
    ]);
    expect(named(channels.spotVolume({ coin: "BTC" }))).toEqual([
      "aggregated_spot_volume_dollars",
      "realtime_BTC#spotvol#Dollars#Aggregated",
    ]);
    expect(named(channels.spotVolume({ coin: "BTC" }, { metric: "coins" }))).toEqual([
      "aggregated_spot_volume_coins",
      AGGREGATE_COINS,
    ]);
  });

  it("types each channel in spot history's buy and sell columns of its metric", () => {
    expectTypeOf(channels.spotVolume(BTC)).toEqualTypeOf<
      Channel<"spot_volume_dollars", Row<SpotExchange, SpotVolumeColumn<"dollar", "buy" | "sell">>>
    >();
    expectTypeOf(channels.spotVolume({ coin: "BTC" }, { metric: "coins" })).toEqualTypeOf<
      Channel<
        "aggregated_spot_volume_coins",
        readonly ExchangeEntry<SpotExchange, SpotVolumeColumn<"coin", "buy" | "sell">>[]
      >
    >();
  });

  it("decodes a coin frame to the history row of its minute, and starts again in the next", () => {
    const coins = channels.spotVolume(BTC, { metric: "coins" });

    /* These are the values /api/v1/rows returned for the same minute. */
    expect(coins.decode(LAST_OF_MINUTE)).toEqual({
      exchange: "coinbase",
      coin: "BTC",
      product: "BTC-USD",
      time: 1789980420000,
      buy_coin_volume: 6.274340380000001,
      sell_coin_volume: 6.488078499999996,
    });
    expect(coins.decode(ROLLOVER)).toEqual({
      exchange: "coinbase",
      coin: "BTC",
      product: "BTC-USD",
      time: 1789980480000,
      buy_coin_volume: 0,
      sell_coin_volume: 2e-8,
    });
  });

  it("decodes a dollar frame to the dollar columns", () => {
    /* These too are the values /api/v1/rows returned for the minute. */
    expect(channels.spotVolume(BTC).decode(DOLLARS_LAST_OF_MINUTE)).toEqual({
      exchange: "coinbase",
      coin: "BTC",
      product: "BTC-USD",
      time: 1789980420000,
      buy_dollar_volume: 524952.2199999997,
      sell_dollar_volume: 542597.0670000002,
    });
  });

  it("decodes a coin's frame to one entry per spot exchange, without a time", () => {
    const entries = channels
      .spotVolume({ coin: "BTC" }, { metric: "coins" })
      .decode(AGGREGATE_FRAME);

    expect(entries.map((entry) => entry.exchange)).toEqual([
      "binance",
      "coinbase",
      "okex",
      "bybit-spot",
    ]);
    expect(entries.find((entry) => entry.exchange === "bybit-spot")).toEqual({
      exchange: "bybit-spot",
      coin: "BTC",
      buy_coin_volume: 7.459489000000012,
      sell_coin_volume: 3.7395369999999937,
    });
  });

  it("follows spot products only", () => {
    // @ts-expect-error futures volume is another channel
    expect(() => channels.spotVolume({ ...BTC, exchange: "binance-futures" })).toThrow(
      'channels.spotVolume() received an invalid exchange "binance-futures"',
    );
  });

  it("has one option, the metric, in the plural; history's spelling is refused", () => {
    // @ts-expect-error history says coin, a channel says coins
    expect(() => channels.spotVolume(BTC, { metric: "coin" })).toThrow(
      'channels.spotVolume() received an unknown metric "coin"; expected coins, dollars',
    );
  });
});
