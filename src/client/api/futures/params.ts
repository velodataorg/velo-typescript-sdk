import { z } from "zod";

import type { Equals, Expect } from "../../../util/types.ts";
import type { Row } from "../../data/row.ts";
import {
  BASIS_COLUMN,
  FUTURES_STANDARD_COLUMNS,
  type FuturesColumn,
  type FuturesStandardColumn,
} from "../../market/columns.ts";
import { FUTURES_EXCHANGES, type FuturesExchange } from "../../market/exchanges.ts";
import { RowsParams } from "../../rows/params.ts";
import type { Resolution } from "../../time/resolution.ts";
import { ResolutionSchema } from "../../time/resolution.ts";
import { END_AFTER_BEGIN, invalidParamsError, timestamp, uniqueArray } from "../../validation.ts";

export type FuturesStandardParams<
  C extends FuturesStandardColumn = FuturesStandardColumn,
  E extends FuturesExchange = FuturesExchange,
> = RowsParams<E, C>;

export type FuturesRow<C extends FuturesColumn, E extends FuturesExchange = FuturesExchange> = Row<
  E,
  C
>;

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

export const FuturesStandardParams = Object.freeze({
  /** Validates standard futures rows parameters while preserving their exact types. */
  parse<P extends FuturesStandardParams>(params: P): P {
    const parsed = FuturesStandardParamsSchema.safeParse(params);
    if (!parsed.success) {
      throw invalidParamsError("futures", parsed.error);
    }
    return structuredClone(params);
  },
});

export const FuturesBasisParams = Object.freeze({
  /** Validates futures basis parameters. */
  parse(params: FuturesBasisParams): FuturesBasisParams {
    const parsed = FuturesBasisParamsSchema.safeParse(params);
    if (!parsed.success) {
      throw invalidParamsError("futures", parsed.error);
    }
    return structuredClone(params);
  },
});

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
