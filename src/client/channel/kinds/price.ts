import { z } from "zod";

import type { Row } from "../../data/row.ts";
import { FUTURES_EXCHANGES, SPOT_EXCHANGES } from "../../market/exchanges.ts";
import type { FuturesExchange, SpotExchange } from "../../market/exchanges.ts";
import { defineChannel, rowBase } from "../define.ts";

/* The history columns a price row fills. Not part of the public API. */
export type PriceColumn =
  | "open_price"
  | "high_price"
  | "low_price"
  | "close_price"
  | "coin_volume"
  | "dollar_volume";

/**
 * What the server sends on a price channel.
 *
 * `d` is the one-minute candle in progress: open, high, low, close, then
 * coin and dollar volume, both cumulative within the minute. `tt` is the
 * tick time in milliseconds. Frames arrive several times a second.
 */
const priceFrameSchema = z.object({
  d: z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()]),
  tt: z.number(),
});

/**
 * The live price of one product, futures or spot.
 *
 * Each frame decodes to the one-minute candle in progress as a history row:
 * identical in shape and meaning to a `1m` row of the price and volume
 * columns from the rows queries. A caller can seed from history and continue from live by
 * upserting on `time`; the last row of a minute equals its history row.
 */
export const price = defineChannel("product", {
  kind: "price",
  exchanges: [...FUTURES_EXCHANGES, ...SPOT_EXCHANGES],
  schema: priceFrameSchema,
  decode: (frame, product): Row<FuturesExchange | SpotExchange, PriceColumn> => ({
    ...rowBase(product, frame.tt),
    open_price: frame.d[0],
    high_price: frame.d[1],
    low_price: frame.d[2],
    close_price: frame.d[3],
    coin_volume: frame.d[4],
    dollar_volume: frame.d[5],
  }),
});
