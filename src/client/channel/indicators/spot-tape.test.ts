import { describe, expect, expectTypeOf, it } from "vitest";

import { channels } from "../../../index.ts";
import type { SpotTradeColumn } from "../../api/spot/selectors.ts";
import type { Row } from "../../data/row.ts";
import type { SpotExchange } from "../../market/exchanges.ts";
import type { Channel } from "../channel.ts";
import type { ExchangeEntry } from "../helpers/decode.ts";

const BTC = { exchange: "coinbase", coin: "BTC", product: "BTC-USD" } as const;
const SINGLE = "realtime_coinbase:BTC-USD#spottape#Trade Count";
const AGGREGATE = "realtime_BTC#spottape#Trade Count#Aggregated";

/* Frames captured live on 2026-09-21 around the 08:48:00 UTC rollover. */
const LAST_OF_MINUTE = { c: SINGLE, d: [343, 446], f: false, tt: 1789980479999 };
const ROLLOVER = { c: SINGLE, d: [0, 1], f: true, tt: 1789980480162 };
/* Captured the same minute, 37 seconds in. */
const AGGREGATE_FRAME = {
  c: AGGREGATE,
  tt: 1789980457259,
  f: false,
  d: {
    realtime_binance: [1876, 2853],
    realtime_coinbase: [217, 309],
    realtime_okex: [451, 257],
    "realtime_bybit-spot": [317, 428],
  },
};

describe("channels.spotTape", () => {
  it("names one channel per target, in the server's word for the spot tape", () => {
    expect([channels.spotTape(BTC).kind, channels.spotTape(BTC).name]).toEqual([
      "spot_tape",
      SINGLE,
    ]);
    const aggregated = channels.spotTape({ coin: "BTC" });
    expect([aggregated.kind, aggregated.name]).toEqual(["aggregated_spot_tape", AGGREGATE]);
  });

  it("types each channel in spot history's buy and sell trade columns", () => {
    expectTypeOf(channels.spotTape(BTC)).toEqualTypeOf<
      Channel<"spot_tape", Row<SpotExchange, SpotTradeColumn<"buy" | "sell">>>
    >();
    expectTypeOf(channels.spotTape({ coin: "BTC" })).toEqualTypeOf<
      Channel<
        "aggregated_spot_tape",
        readonly ExchangeEntry<SpotExchange, SpotTradeColumn<"buy" | "sell">>[]
      >
    >();
  });

  it("decodes a frame to the history row of its minute, and starts again in the next", () => {
    /* These are the values /api/v1/rows returned for the same minute. */
    expect(channels.spotTape(BTC).decode(LAST_OF_MINUTE)).toEqual({
      exchange: "coinbase",
      coin: "BTC",
      product: "BTC-USD",
      time: 1789980420000,
      buy_trades: 343,
      sell_trades: 446,
    });
    expect(channels.spotTape(BTC).decode(ROLLOVER)).toEqual({
      exchange: "coinbase",
      coin: "BTC",
      product: "BTC-USD",
      time: 1789980480000,
      buy_trades: 0,
      sell_trades: 1,
    });
  });

  it("decodes a coin's frame to one entry per spot exchange, without a time", () => {
    const entries = channels.spotTape({ coin: "BTC" }).decode(AGGREGATE_FRAME);

    expect(entries).toHaveLength(4);
    expect(entries.find((entry) => entry.exchange === "okex")).toEqual({
      exchange: "okex",
      coin: "BTC",
      buy_trades: 451,
      sell_trades: 257,
    });
  });

  it("follows spot products only", () => {
    // @ts-expect-error the futures tape is another channel
    expect(() => channels.spotTape({ ...BTC, exchange: "binance-futures" })).toThrow(
      'channels.spotTape() received an invalid exchange "binance-futures"',
    );
  });
});
