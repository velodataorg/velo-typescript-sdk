import { z } from "zod";

import type { Product } from "../../market/product.ts";
import { invalidParamsError } from "../../validation.ts";

export type CatalogParams<E extends string> =
  | {
      readonly coin: string;
      readonly product?: never;
      readonly exchange?: E;
    }
  | {
      readonly product: string;
      readonly coin?: never;
      readonly exchange?: E;
    }
  | {
      readonly coin?: never;
      readonly product?: never;
      readonly exchange?: E;
    };

export interface PreparedCatalogParams {
  readonly coin: string | undefined;
  readonly product: string | undefined;
  readonly exchange: string | undefined;
  readonly delisted: boolean;
  readonly depth: boolean | undefined;
}

/* Markets whose params never allow `depth` (spot, options) also lack the row
 * field, so their filter branch below is unreachable.
 */
interface CatalogProduct extends Product<string> {
  readonly depth?: boolean;
}

export const CatalogParams = Object.freeze({
  /** Validates and normalizes one market's catalog search. */
  parse<E extends string>(
    market: string,
    params: CatalogParams<E> & { readonly delisted?: boolean; readonly depth?: boolean },
    exchanges: readonly [E, ...E[]],
    allow: { readonly delisted: boolean; readonly depth: boolean },
  ): PreparedCatalogParams {
    const exchangeSchema = z
      .string()
      .min(1)
      .transform((value) => value.toLowerCase())
      .pipe(z.enum(exchanges))
      .optional();
    const catalogParamsSchema = z
      .strictObject({
        coin: z.string().min(1).optional(),
        product: z.string().min(1).optional(),
        exchange: exchangeSchema,
        delisted: z.boolean().optional(),
        depth: z.boolean().optional(),
      })
      .refine((value) => value.coin === undefined || value.product === undefined, {
        message: "coin and product are mutually exclusive",
      })
      .refine((value) => allow.delisted || value.delisted === undefined, {
        path: ["delisted"],
        message: `${market} catalog does not support delisted products`,
      })
      .refine((value) => allow.depth || value.depth === undefined, {
        path: ["depth"],
        message: `${market} catalog does not support depth filtering`,
      });

    const parsed = catalogParamsSchema.safeParse(params);
    if (!parsed.success) {
      throw invalidParamsError(`${market} catalog`, parsed.error);
    }

    return {
      coin: parsed.data.coin,
      product: parsed.data.product,
      exchange: parsed.data.exchange,
      delisted: parsed.data.delisted ?? false,
      depth: parsed.data.depth,
    };
  },

  /** Tests one row against the selectors the catalog HTTP endpoints ignore. */
  matches<T extends CatalogProduct>(row: T, params: PreparedCatalogParams): boolean {
    const { coin, product, exchange, depth } = params;
    return (
      (coin === undefined || row.coin.toLowerCase() === coin.toLowerCase()) &&
      (product === undefined || row.product.toLowerCase() === product.toLowerCase()) &&
      (exchange === undefined || row.exchange.toLowerCase() === exchange.toLowerCase()) &&
      (depth === undefined || row.depth === depth)
    );
  },

  /** Applies the selectors the catalog HTTP endpoints ignore. */
  filter<T extends CatalogProduct>(rows: T[], params: PreparedCatalogParams): T[] {
    const { coin, product, exchange, depth } = params;
    if (
      coin === undefined &&
      product === undefined &&
      exchange === undefined &&
      depth === undefined
    ) {
      return rows;
    }
    return rows.filter((row) => CatalogParams.matches(row, params));
  },
});
