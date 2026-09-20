import { assert } from "../../../util/assert.ts";
import { isRecord } from "../../../util/object.ts";
import { isNonEmptyString } from "../../../util/string.ts";
import type { Exchange } from "../../market/exchanges.ts";
import type { Product } from "../../market/product.ts";

/*
 * What a channel follows. A product is followed on its one exchange, as a
 * single channel. A coin is followed across exchanges, as an aggregated
 * channel. The target says which, so no option has to.
 */

/*
 * A coin across exchanges. The fields it may not have keep a product from
 * passing as one, the way a history scope keeps `products` and `coins` apart.
 */
export interface Coin {
  /* The Velo coin symbol, as the catalog returns it. */
  readonly coin: string;
  readonly exchange?: never;
  readonly product?: never;
}

export type Target<X extends string = Exchange> = Product<X> | Coin;

/* A target once checked, under the scope of the channel it gets. */
export type ParsedTarget<X extends string> =
  | { readonly scope: "single"; readonly product: Product<X> }
  | { readonly scope: "aggregated"; readonly coin: string };

/**
 * Validates and snapshots the product a single channel follows.
 *
 * @param builder - The public builder name, used in error messages.
 * @param exchanges - The exchanges that publish the indicator.
 * @param input - The caller's target; extra fields, as on a catalog row, are dropped.
 * @returns A frozen product holding only the three fields.
 * @throws A VeloError when the target is not an object, its exchange does not
 * publish the indicator, or a field is not usable.
 */
export function parseProduct<X extends string>(
  builder: string,
  exchanges: readonly X[],
  input: unknown,
): Product<X> {
  assert(isRecord(input), () => `${builder}() takes a product, as the catalog returns it`);
  const { exchange, coin, product } = input;
  assert(
    isNonEmptyString(exchange) && isListed(exchanges, exchange),
    () => `${builder}() received an invalid exchange ${JSON.stringify(exchange)}`,
  );
  assert(
    isNonEmptyString(coin),
    () => `${builder}() takes a product whose coin is a non-empty string`,
  );
  assert(
    isNonEmptyString(product),
    () => `${builder}() takes a product whose product is a non-empty string`,
  );
  return Object.freeze({ exchange, coin, product });
}

/**
 * Validates a target and tells a product from a coin.
 *
 * @remarks
 * A target naming an exchange or a product is read as a product, and must
 * then be a whole one. That keeps a product missing a field from being
 * followed as its coin across every exchange.
 *
 * @param builder - The public builder name, used in error messages.
 * @param exchanges - The exchanges that publish the indicator.
 * @param input - The caller's target.
 * @returns The snapshotted product, or the coin symbol, under its scope.
 * @throws A VeloError when the target is neither a usable product nor a
 * usable coin.
 */
export function parseTarget<X extends string>(
  builder: string,
  exchanges: readonly X[],
  input: unknown,
): ParsedTarget<X> {
  assert(
    isRecord(input),
    () =>
      `${builder}() takes a product, as the catalog returns it, or a coin, such as { coin: "BTC" }`,
  );
  if ("exchange" in input || "product" in input) {
    return { scope: "single", product: parseProduct(builder, exchanges, input) };
  }
  const { coin } = input;
  assert(
    isNonEmptyString(coin),
    () => `${builder}() takes a coin whose coin is a non-empty string`,
  );
  return { scope: "aggregated", coin };
}

/**
 * Whether an exchange is one of those that publish an indicator.
 *
 * @param exchanges - The exchanges that publish the indicator.
 * @param exchange - The candidate.
 * @returns Whether `exchange` is listed.
 */
function isListed<X extends string>(exchanges: readonly X[], exchange: string): exchange is X {
  const listed: readonly string[] = exchanges;
  return listed.includes(exchange);
}
