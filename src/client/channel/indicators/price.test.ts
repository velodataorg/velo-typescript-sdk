import { describe, expect, expectTypeOf, it } from "vitest";

import { channel, VeloError } from "../../../index.ts";
import type { Row } from "../../data/row.ts";
import type { FuturesExchange, SpotExchange } from "../../market/exchanges.ts";
import type { Channel } from "../channel.ts";

const BTC = { exchange: "binance-futures", coin: "BTC", product: "BTCUSDT" } as const;
const NAME = "realtime_binance-futures:BTCUSDT";

type PriceColumn =
  | "open_price"
  | "high_price"
  | "low_price"
  | "close_price"
  | "coin_volume"
  | "dollar_volume";

/* Frames captured live on 2026-09-17 around the 10:50:00 UTC rollover. */
const LAST_OF_MINUTE = {
  c: NAME,
  d: [76250, 76299.8, 76249.9, 76269.7, 81.873, 6245352.43],
  f: false,
  tt: 1789642199999,
};
const ROLLOVER = {
  c: NAME,
  d: [76269.7, 76269.7, 76269.7, 76269.7, 0, 0],
  f: true,
  tt: 1789642200599,
};

describe("channel.price", () => {
  it("names the channel from the exchange and product alone, under the price kind", () => {
    const btc = channel.price(BTC);

    expectTypeOf(btc).toEqualTypeOf<
      Channel<"price", Row<FuturesExchange | SpotExchange, PriceColumn>>
    >();
    expect([btc.kind, btc.name]).toEqual(["price", NAME]);
  });

  it("follows futures and spot products, and no others", () => {
    expect(channel.price({ exchange: "coinbase", coin: "BTC", product: "BTC-USD" }).name).toBe(
      "realtime_coinbase:BTC-USD",
    );
    // @ts-expect-error not an exchange that publishes prices
    expect(() => channel.price({ ...BTC, exchange: "deribit-options" })).toThrow(
      'channel.price() received an invalid exchange "deribit-options"',
    );
  });

  it("decodes a frame to the history row of its minute", () => {
    const btc = channel.price(BTC);

    /* These are the values /api/v1/rows returned for the same minute. */
    expect(btc.decode(LAST_OF_MINUTE)).toEqual({
      exchange: "binance-futures",
      coin: "BTC",
      product: "BTCUSDT",
      time: 1789642140000,
      open_price: 76250,
      high_price: 76299.8,
      low_price: 76249.9,
      close_price: 76269.7,
      coin_volume: 81.873,
      dollar_volume: 6245352.43,
    });
    /* The new candle opens at the previous close, with no volume yet. */
    expect(btc.decode(ROLLOVER)).toMatchObject({
      time: 1789642200000,
      open_price: 76269.7,
      coin_volume: 0,
    });
  });

  it("follows a product only, since the server publishes no price across exchanges", () => {
    // @ts-expect-error price takes a product, never a coin
    const aggregated = () => channel.price({ coin: "BTC" });
    expect(aggregated).toThrow(VeloError);
  });
});
