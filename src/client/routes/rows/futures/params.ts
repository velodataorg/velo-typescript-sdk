import { z } from "zod";

import { VeloError } from "../../../../errors.js";
import { FUTURES_EXCHANGES, type FuturesExchange } from "../../../../exchange.js";
import { timestamp, uniqueArray } from "../../../../schema.js";
import {
  BASIS_COLUMN,
  FUTURES_STANDARD_COLUMNS,
  type FuturesColumn,
  type FuturesStandardColumn,
} from "../columns.js";
import type { Row } from "../data.js";
import { RowsParams } from "../params.js";
import type { Resolution } from "../util/resolution.js";
import { ResolutionSchema } from "../util/resolution.js";

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
