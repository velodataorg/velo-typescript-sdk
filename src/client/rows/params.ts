import { z } from "zod";

import type { Resolution } from "./resolution.js";
import { ResolutionSchema } from "./resolution.js";

export const MAX_TIMESTAMP_MS = 8.64e15;

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

export interface ValidatedRowsParams {
  readonly exchanges?: readonly string[];
  readonly columns: readonly string[];
  readonly products?: readonly string[];
  readonly coins?: readonly string[];
  readonly begin: number;
  readonly end: number;
  readonly resolution: Resolution;
}

export const TimestampParamSchema = z.number().int().nonnegative().max(MAX_TIMESTAMP_MS);

const NonEmptyStringArraySchema = uniqueArray(z.string().min(1));

/**
 * Creates the strict parameter schema shared by ordinary market queries.
 */
export function createRowsParamsSchema<
  E extends readonly [string, ...string[]],
  C extends readonly [string, ...string[]],
>(exchanges: E, columns: C) {
  const common = {
    exchanges: uniqueArray(z.enum(exchanges)),
    columns: uniqueArray(z.enum(columns)),
    begin: TimestampParamSchema,
    end: TimestampParamSchema,
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
}

/**
 * Creates a required, duplicate-free array schema.
 */
export function uniqueArray<Item extends z.ZodType>(item: Item) {
  return z
    .array(item)
    .min(1)
    .refine((items) => new Set(items).size === items.length, {
      message: "must not contain duplicates",
    });
}
