import { z } from "zod";

import { timestamp, uniqueArray } from "../validation.js";
import type { Resolution } from "./resolution.js";
import { ResolutionSchema } from "./resolution.js";

export type MarketType = "futures" | "options" | "spot";

/*//////////////////////////////////////////////////////////////
                            ROW PARAMS
//////////////////////////////////////////////////////////////*/

interface RowsParamsBase<E extends string, C extends string> {
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
  readonly products: readonly string[];
  readonly coins?: never;
}

export interface RowsParamsCoins<E extends string, C extends string> extends RowsParamsBase<E, C> {
  readonly coins: readonly string[];
  readonly products?: never;
}

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
      .refine((params) => params.end > params.begin, {
        path: ["end"],
        message: "must be a millisecond timestamp after begin",
      });
  },
});
