import { z } from "zod";

import { FUTURES_EXCHANGES, SPOT_EXCHANGES } from "../../market/exchanges.ts";
import { defineChannel } from "../define.ts";

/**
 * The live price of one product, futures or spot.
 *
 * Each frame decodes to the one-minute candle in progress as a history row:
 * identical in shape and meaning to a `1m` row of the price and volume
 * columns from the rows queries. A caller can seed from history and continue from live by
 * upserting on `time`; the last row of a minute equals its history row.
 *
 * The payload is that candle: open, high, low, close, then coin and dollar
 * volume, both cumulative within the minute. Frames arrive several times a
 * second.
 */
export const price = defineChannel("product", {
  kind: "price",
  exchanges: [...FUTURES_EXCHANGES, ...SPOT_EXCHANGES],
  payload: z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()]),
  columns: ([open, high, low, close, coinVolume, dollarVolume]) => ({
    open_price: open,
    high_price: high,
    low_price: low,
    close_price: close,
    coin_volume: coinVolume,
    dollar_volume: dollarVolume,
  }),
});
