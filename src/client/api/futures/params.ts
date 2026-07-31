import { z } from "zod";

import type { Equals, Expect } from "../../../util/types.js";
import {
  BASIS_COLUMN,
  FUTURES_STANDARD_COLUMNS,
  type FuturesStandardColumn,
} from "../../common/market/columns.js";
import { FUTURES_EXCHANGES, type FuturesExchange } from "../../common/market/exchanges.js";
import { RowsParams } from "../../common/rows/params.js";
import type { Resolution } from "../../common/time/resolution.js";
import { ResolutionSchema } from "../../common/time/resolution.js";
import {
  END_AFTER_BEGIN,
  invalidParamsError,
  timestamp,
  uniqueArray,
} from "../../common/validation.js";

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
  .refine(...END_AFTER_BEGIN);

const FuturesParamsSchema = z.union([FuturesStandardParamsSchema, FuturesBasisParamsSchema]);

/* parse() returns a clone of its input, so the schema must never transform values. */
type _SchemaDoesNotTransform = Expect<
  Equals<z.input<typeof FuturesParamsSchema>, z.output<typeof FuturesParamsSchema>>
>;

export const FuturesParams = Object.freeze({
  /** Validates futures parameters while preserving their static column selection. */
  parse<P extends FuturesParams>(params: P): P {
    const parsed = FuturesParamsSchema.safeParse(params);
    if (!parsed.success) {
      throw invalidParamsError("futures", parsed.error);
    }

    /* Return a clone of the validated input: its type is already P, where Zod's
       output necessarily widens back to the full column union. */
    return structuredClone(params);
  },
});
