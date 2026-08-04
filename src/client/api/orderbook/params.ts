import { z } from "zod";

import { FUTURES_EXCHANGES, type FuturesExchange } from "../../common/market/exchanges.ts";
import { MinuteResolutionSchema, type MinuteResolution } from "../../common/time/resolution.ts";
import { END_AFTER_BEGIN, invalidParamsError, timestamp } from "../../common/validation.ts";

/* The levels endpoint takes a minute-denominated bucket size, so calendar
 * resolutions are out.
 */
export type OrderbookResolution = MinuteResolution;

interface OrderbookParamsBase {
  readonly begin: number;
  readonly end: number;
  readonly resolution: OrderbookResolution;
}

export interface OrderbookParamsProduct extends OrderbookParamsBase {
  readonly exchange: FuturesExchange;

  /** An exchange-native symbol, for example `BTCUSDT` on binance-futures. */
  readonly product: string;
  readonly coin?: never;
}

export interface OrderbookParamsCoin extends OrderbookParamsBase {
  /** A Velo-aggregated symbol whose book combines every tracked exchange. */
  readonly coin: string;
  readonly exchange?: never;
  readonly product?: never;
}

/**
 * Parameters accepted by the orderbook query.
 *
 * @remarks
 * The target is one specific product or one aggregated coin, never both.
 * Depth history exists for futures products only;
 * `catalog.futures({ depth: true }).fetch()` lists the covered products.
 */
export type OrderbookParams = OrderbookParamsProduct | OrderbookParamsCoin;

const common = {
  begin: timestamp,
  end: timestamp,
  resolution: MinuteResolutionSchema,
};

const OrderbookParamsSchema = z
  .union([
    z.strictObject({
      ...common,
      exchange: z.enum(FUTURES_EXCHANGES),
      product: z.string().min(1),
    }),
    z.strictObject({
      ...common,
      coin: z.string().min(1),
    }),
  ])
  .refine(...END_AFTER_BEGIN);

export const OrderbookParams = Object.freeze({
  /** Validates orderbook parameters. */
  parse(params: OrderbookParams): OrderbookParams {
    const parsed = OrderbookParamsSchema.safeParse(params);
    if (!parsed.success) {
      throw invalidParamsError("orderbook", parsed.error);
    }

    return parsed.data;
  },
});
