import { assert } from "../../../util/assert.ts";

/**
 * Identifies one product within a rows result: `"exchange:product"`.
 *
 * Products may contain `:`, but exchange ids never do, so the first colon
 * splits unambiguously.
 *
 * @typeParam E - Exchanges the market may return.
 */
export type ProductKey<E extends string = string> = `${E}:${string}`;

/**
 * Formats an exchange and product as a product key.
 */
export function formatProductKey<E extends string>(exchange: E, product: string): ProductKey<E> {
  assert(
    exchange.length > 0 && !exchange.includes(":"),
    () => `Invalid exchange ${JSON.stringify(exchange)}: expected a non-empty value without ":"`,
  );
  assert(product.length > 0, "Invalid product: expected a non-empty value");
  return `${exchange}:${product}`;
}

/**
 * Parses a product key into its exchange and product.
 */
export function parseProductKey<E extends string>(
  key: ProductKey<E>,
): { readonly exchange: E; readonly product: string } {
  const separator = key.indexOf(":");
  assert(
    separator > 0 && separator < key.length - 1,
    () => `Invalid product key ${JSON.stringify(key)}: expected "exchange:product"`,
  );
  return {
    exchange: key.slice(0, separator) as E,
    product: key.slice(separator + 1),
  };
}
