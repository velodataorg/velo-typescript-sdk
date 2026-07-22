import { z } from "zod";

import { VeloError } from "../../../errors.js";
import {
  BASIS_COLUMN,
  FUTURES_STANDARD_COLUMNS,
  type FuturesStandardColumn,
} from "../../common/market/columns.js";
import { FUTURES_EXCHANGES, type FuturesExchange } from "../../common/market/exchanges.js";
import { RowsParams } from "../../common/rows/params.js";
import type { Resolution } from "../../common/rows/resolution.js";
import { ResolutionSchema } from "../../common/rows/resolution.js";
import { timestamp, uniqueArray } from "../../common/validation.js";

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

const FuturesStandardParamsSchema = RowsParams.schema(FUTURES_EXCHANGES, FUTURES_STANDARD_COLUMNS);

const FuturesBasisParamsSchema = z
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

const FuturesParamsSchema = z.union([FuturesStandardParamsSchema, FuturesBasisParamsSchema]);

export const FuturesParams = Object.freeze({
  /** Validates futures parameters while preserving their static column selection. */
  parse<P extends FuturesParams>(params: P): P {
    const parsed = FuturesParamsSchema.safeParse(params);
    if (!parsed.success) {
      throw new VeloError(`Invalid futures params:\n${z.prettifyError(parsed.error)}`);
    }

    /* Zod preserves the selected columns but necessarily returns their full schema union. */
    return parsed.data as unknown as P;
  },
});
