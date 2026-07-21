import { z } from "zod";

import { VeloError } from "../../../../errors.js";
import { FUTURES_EXCHANGES, type FuturesExchange } from "../../../../exchange.js";
import { timestamp, uniqueArray } from "../../../../schema.js";
import type { Row } from "../data.js";
import { RowsParams } from "../params.js";
import type { Resolution } from "../util/resolution.js";
import { ResolutionSchema } from "../util/resolution.js";

export const FUTURES_STANDARD_COLUMNS = [
  "open_price",
  "high_price",
  "low_price",
  "close_price",
  "coin_volume",
  "dollar_volume",
  "buy_trades",
  "sell_trades",
  "total_trades",
  "buy_coin_volume",
  "sell_coin_volume",
  "buy_dollar_volume",
  "sell_dollar_volume",
  "coin_open_interest_high",
  "coin_open_interest_low",
  "coin_open_interest_close",
  "dollar_open_interest_high",
  "dollar_open_interest_low",
  "dollar_open_interest_close",
  "funding_rate",
  "funding_rate_avg",
  "premium",
  "buy_liquidations",
  "sell_liquidations",
  "buy_liquidations_coin_volume",
  "sell_liquidations_coin_volume",
  "liquidations_coin_volume",
  "buy_liquidations_dollar_volume",
  "sell_liquidations_dollar_volume",
  "liquidations_dollar_volume",
] as const;

export const BASIS_COLUMN = "3m_basis_ann";
export const FUTURES_COLUMNS = [...FUTURES_STANDARD_COLUMNS, BASIS_COLUMN] as const;

export type FuturesColumn = (typeof FUTURES_COLUMNS)[number];
export type FuturesStandardColumn = (typeof FUTURES_STANDARD_COLUMNS)[number];
export type FuturesRow<C extends FuturesColumn> = Row<FuturesExchange, C>;
export type FuturesStandardParams<C extends FuturesStandardColumn = FuturesStandardColumn> =
  RowsParams<FuturesExchange, C>;

export const BASIS_COINS = ["BTC", "ETH"] as const;
export type BasisCoin = (typeof BASIS_COINS)[number];

export interface FuturesBasisParams {
  readonly columns: readonly [typeof BASIS_COLUMN];
  readonly coins: readonly BasisCoin[];
  readonly exchanges?: never;
  readonly products?: never;
  readonly begin: number;
  readonly end: number;
  readonly resolution: Resolution;
}

export type FuturesParams = FuturesStandardParams | FuturesBasisParams;

const StandardParamsSchema = RowsParams.schema(FUTURES_EXCHANGES, FUTURES_STANDARD_COLUMNS);

const BasisParamsSchema = z
  .strictObject({
    columns: z.tuple([z.literal(BASIS_COLUMN)]),
    coins: uniqueArray(z.enum(BASIS_COINS)),
    begin: timestamp,
    end: timestamp,
    resolution: ResolutionSchema,
  })
  .refine((params) => params.end > params.begin, {
    path: ["end"],
    message: "must be a millisecond timestamp after begin",
  });

const ParamsSchema = z.union([StandardParamsSchema, BasisParamsSchema]);

export const FuturesParams = Object.freeze({
  /** Validates futures parameters while preserving their static column selection. */
  parse<P extends FuturesParams>(params: P): P {
    const parsed = ParamsSchema.safeParse(params);
    if (!parsed.success) {
      throw new VeloError(`Invalid futures params:\n${z.prettifyError(parsed.error)}`);
    }

    /* Zod preserves the selected columns but necessarily returns their full schema union. */
    return parsed.data as unknown as P;
  },
});
