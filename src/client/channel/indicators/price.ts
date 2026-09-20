import { z } from "zod";

import { FUTURES_EXCHANGES, SPOT_EXCHANGES } from "../../market/exchanges.ts";
import type { Product } from "../../market/product.ts";
import { singleChannel } from "../helpers/build.ts";
import type { ChannelDefinition, ChannelFor } from "../helpers/build.ts";
import { parseProduct } from "../helpers/target.ts";

const BUILDER = "channel.price";
const EXCHANGES = [...FUTURES_EXCHANGES, ...SPOT_EXCHANGES];
type PriceExchange = (typeof EXCHANGES)[number];

/* The one-minute candle in progress: open, high, low, close, then coin and dollar volume. */
const candle = z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()]);

const PRICE = {
  words: [],
  kind: "price",
  payload: candle,
  columns: ([open, high, low, close, coinVolume, dollarVolume]: z.infer<typeof candle>) => ({
    open_price: open,
    high_price: high,
    low_price: low,
    close_price: close,
    coin_volume: coinVolume,
    dollar_volume: dollarVolume,
  }),
} as const satisfies ChannelDefinition<z.infer<typeof candle>>;

/**
 * The live price of one product, futures or spot.
 *
 * @remarks
 * Each frame decodes to the one-minute candle in progress as a history row:
 * identical in shape and meaning to a `1m` row of the price and volume
 * columns from the rows queries. A caller can seed from history and continue
 * from live by upserting on `time`; the last row of a minute equals its
 * history row.
 *
 * Both volumes are cumulative within the minute. Frames arrive several times
 * a second. The server publishes no price across exchanges, so price follows
 * a product only, never a coin.
 *
 * @param product - A product, as the catalog returns it.
 * @returns The frozen channel.
 * @throws A VeloError when the product is not usable.
 */
export function price(
  product: Product<PriceExchange>,
): ChannelFor<Product<PriceExchange>, PriceExchange, typeof PRICE> {
  return singleChannel(parseProduct(BUILDER, EXCHANGES, product), PRICE);
}
