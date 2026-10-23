import { FUTURES_EXCHANGES, SPOT_EXCHANGES } from "../../market/exchanges.ts";
import type { Product } from "../../market/product.ts";
import { singleChannel } from "../helpers/build.ts";
import type { ChannelDefinition, SingleChannel } from "../helpers/build.ts";
import { parseProduct } from "../helpers/target.ts";

const INDICATOR = "channels.price";
const EXCHANGES = [...FUTURES_EXCHANGES, ...SPOT_EXCHANGES];
type PriceExchange = (typeof EXCHANGES)[number];

/* The one-minute candle in progress, both volumes cumulative within the minute. */
const PRICE = {
  suffix: "",
  kind: "price",
  columns: ["open_price", "high_price", "low_price", "close_price", "coin_volume", "dollar_volume"],
} as const satisfies ChannelDefinition;

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
export function price(product: Product<PriceExchange>): SingleChannel<PriceExchange, typeof PRICE> {
  return singleChannel(parseProduct(product, EXCHANGES, INDICATOR), PRICE);
}
