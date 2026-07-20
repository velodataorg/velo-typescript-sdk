import { z } from "zod";

import { VeloError } from "../../errors.js";

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

/**
 * Validates and normalizes one market's catalog search.
 */
export function prepareCatalogParams<E extends string>(
  market: string,
  params: CatalogParams<E> & { readonly delisted?: boolean },
  exchanges: readonly [E, ...E[]],
  allowDelisted: boolean,
): PreparedCatalogParams {
  const exchange = z
    .string()
    .min(1)
    .transform((value) => value.toLowerCase())
    .pipe(z.enum(exchanges))
    .optional();
  const selectors = {
    coin: z.string().min(1).optional(),
    product: z.string().min(1).optional(),
    exchange,
  };
  const schema = z
    .strictObject({ ...selectors, delisted: z.boolean().optional() })
    .refine((value) => value.coin === undefined || value.product === undefined, {
      message: "coin and product are mutually exclusive",
    })
    .refine((value) => allowDelisted || value.delisted === undefined, {
      path: ["delisted"],
      message: `${market} catalog does not support delisted products`,
    });

  const result = schema.safeParse(params);
  if (!result.success) {
    throw new VeloError(`Invalid ${market} catalog params:\n${z.prettifyError(result.error)}`);
  }

  return {
    coin: result.data.coin,
    product: result.data.product,
    exchange: result.data.exchange,
    delisted: result.data.delisted ?? false,
  };
}

/**
 * Applies the selectors the catalog HTTP endpoints ignore.
 */
export function filterCatalog<T extends CatalogProduct>(
  rows: T[],
  params: PreparedCatalogParams,
): T[] {
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
}
