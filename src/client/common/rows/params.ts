import { z } from "zod";

import type { Resolution } from "../time/resolution.js";
import { ResolutionSchema } from "../time/resolution.js";
import { END_AFTER_BEGIN, timestamp, uniqueArray } from "../validation.js";

export type MarketType = "futures" | "options" | "spot";

/*//////////////////////////////////////////////////////////////
                            ROW PARAMS
//////////////////////////////////////////////////////////////*/

interface RowsParamsBase<E extends string, C extends string> {
  /**
   * Cross-joins with `products` or `coins`: the result holds one series per
   * (exchange, product) pair, so row counts and query width scale with the
   * product of the list lengths, not their sum.
   */
  readonly exchanges: readonly E[];
  readonly columns: readonly C[];
  readonly begin: number;
  readonly end: number;
  readonly resolution: Resolution;
}

export interface RowsParamsProducts<E extends string, C extends string> extends RowsParamsBase<
  E,
  C
> {
  /**
   * Exchange-native symbols, each requested on every exchange; pairs that do
   * not trade on an exchange contribute no rows.
   */
  readonly products: readonly string[];
  readonly coins?: never;
}

export interface RowsParamsCoins<E extends string, C extends string> extends RowsParamsBase<E, C> {
  /**
   * Velo-aggregated symbols, each requested on every exchange; pairs that do
   * not trade on an exchange contribute no rows.
   */
  readonly coins: readonly string[];
  readonly products?: never;
}

/**
 * Parameters accepted by the market rows queries.
 *
 * @remarks
 * The target is either `products` or `coins`, never both. `exchanges`
 * cross-joins with the target: the result holds one series per
 * (exchange, product) pair.
 *
 * @typeParam E - Exchanges the market supports.
 * @typeParam C - Columns the market supports.
 */
export type RowsParams<E extends string, C extends string> =
  | RowsParamsProducts<E, C>
  | RowsParamsCoins<E, C>;

export interface RowsQueryParams<C extends string = string> {
  readonly exchanges?: readonly string[];
  readonly columns: readonly C[];
  readonly products?: readonly string[];
  readonly coins?: readonly string[];
  readonly begin: number;
  readonly end: number;
  readonly resolution: Resolution;
}

const NonEmptyStringArraySchema = uniqueArray(z.string().min(1));

export const RowsParams = Object.freeze({
  /** Creates the strict parameter schema shared by ordinary market queries. */
  schema<E extends readonly [string, ...string[]], C extends readonly [string, ...string[]]>(
    exchanges: E,
    columns: C,
  ) {
    const common = {
      exchanges: uniqueArray(z.enum(exchanges)),
      columns: uniqueArray(z.enum(columns)),
      begin: timestamp,
      end: timestamp,
      resolution: ResolutionSchema,
    };

    return z
      .union([
        z.strictObject({
          ...common,
          products: NonEmptyStringArraySchema,
        }),
        z.strictObject({
          ...common,
          coins: NonEmptyStringArraySchema,
        }),
      ])
      .refine(...END_AFTER_BEGIN);
  },
});
