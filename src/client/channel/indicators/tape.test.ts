import { describe, expect, expectTypeOf, it } from "vitest";

import { channel } from "../../../index.ts";
import type { FuturesTradeColumn } from "../../api/futures/selectors.ts";
import type { Row } from "../../data/row.ts";
import type { FuturesExchange } from "../../market/exchanges.ts";
import type { Channel } from "../channel.ts";
import type { ExchangeEntry } from "../helpers/decode.ts";

const BTC = { exchange: "binance-futures", coin: "BTC", product: "BTCUSDT" } as const;
const SINGLE = "realtime_binance-futures:BTCUSDT#tape#Trade Count";
const AGGREGATE = "realtime_BTC#tape#Trade Count#Aggregated";

/* Frames captured live on 2026-09-21 around the 08:48:00 UTC rollover. */
const LAST_OF_MINUTE = { c: SINGLE, d: [6576, 6664], f: false, tt: 1789980479999 };
const ROLLOVER = { c: SINGLE, d: [0, 1], f: true, tt: 1789980480008 };
/* The last frame of the same minute, in which binance-futures holds the numbers above. */
const AGGREGATE_FRAME = {
  c: AGGREGATE,
  tt: 1789980479999,
  f: false,
  d: {
    realtime_hyperliquid: [357, 453],
    realtime_bybit: [3884, 4110],
    "realtime_binance-futures": [6576, 6664],
    "realtime_okex-swap": [6278, 5604],
    "realtime_okex-coin-margin": [525, 261],
    "realtime_binance-coin-margin": [806, 568],
    "realtime_bybit-coin-margin": [99, 34],
    realtime_deribit: [193, 330],
  },
};

describe("channel.tape", () => {
  it("names one channel per target", () => {
    expect([channel.tape(BTC).kind, channel.tape(BTC).name]).toEqual(["tape", SINGLE]);
    expect([channel.tape({ coin: "BTC" }).kind, channel.tape({ coin: "BTC" }).name]).toEqual([
      "aggregated_tape",
      AGGREGATE,
    ]);
  });

  it("types each channel in history's buy and sell trade columns", () => {
    expectTypeOf(channel.tape(BTC)).toEqualTypeOf<
      Channel<"tape", Row<FuturesExchange, FuturesTradeColumn<"buy" | "sell">>>
    >();
    expectTypeOf(channel.tape({ coin: "BTC" })).toEqualTypeOf<
      Channel<
        "aggregated_tape",
        readonly ExchangeEntry<FuturesExchange, FuturesTradeColumn<"buy" | "sell">>[]
      >
    >();
  });

  it("decodes a frame to the history row of its minute, and starts again in the next", () => {
    /* These are the values /api/v1/rows returned for the same minute. */
    expect(channel.tape(BTC).decode(LAST_OF_MINUTE)).toEqual({
      exchange: "binance-futures",
      coin: "BTC",
      product: "BTCUSDT",
      time: 1789980420000,
      buy_trades: 6576,
      sell_trades: 6664,
    });
    expect(channel.tape(BTC).decode(ROLLOVER)).toEqual({
      exchange: "binance-futures",
      coin: "BTC",
      product: "BTCUSDT",
      time: 1789980480000,
      buy_trades: 0,
      sell_trades: 1,
    });
  });

  it("decodes a coin's frame to one entry per exchange, in the product columns, without a time", () => {
    const entries = channel.tape({ coin: "BTC" }).decode(AGGREGATE_FRAME);

    expect(entries).toHaveLength(8);
    expect(entries.find((entry) => entry.exchange === "binance-futures")).toEqual({
      exchange: "binance-futures",
      coin: "BTC",
      buy_trades: 6576,
      sell_trades: 6664,
    });
  });

  it("follows futures products only", () => {
    // @ts-expect-error the spot tape is another channel
    expect(() => channel.tape({ ...BTC, exchange: "binance" })).toThrow(
      'channel.tape() received an invalid exchange "binance"',
    );
  });
});
