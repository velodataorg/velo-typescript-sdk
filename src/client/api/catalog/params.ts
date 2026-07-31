import { z } from "zod";

import { invalidParamsError } from "../../common/validation.js";

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
}

interface CatalogProduct {
  readonly coin: string;
  readonly product: string;
  readonly exchange: string;
}

export const CatalogParams = Object.freeze({
  /** Validates and normalizes one market's catalog search. */
  parse<E extends string>(
    market: string,
    params: CatalogParams<E> & { readonly delisted?: boolean },
    exchanges: readonly [E, ...E[]],
    allowDelisted: boolean,
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
      })
      .refine((value) => value.coin === undefined || value.product === undefined, {
        message: "coin and product are mutually exclusive",
      })
      .refine((value) => allowDelisted || value.delisted === undefined, {
        path: ["delisted"],
        message: `${market} catalog does not support delisted products`,
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
    };
  },

  /** Applies the selectors the catalog HTTP endpoints ignore. */
  filter<T extends CatalogProduct>(rows: T[], params: PreparedCatalogParams): T[] {
    const { coin, product, exchange } = params;
    if (coin === undefined && product === undefined && exchange === undefined) return rows;

    const normalizedCoin = coin?.toLowerCase();
    const normalizedProduct = product?.toLowerCase();

    return rows.filter(
      (row) =>
        (normalizedCoin === undefined || row.coin.toLowerCase() === normalizedCoin) &&
        (normalizedProduct === undefined || row.product.toLowerCase() === normalizedProduct) &&
        (exchange === undefined || row.exchange.toLowerCase() === exchange),
    );
  },
});
