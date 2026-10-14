import { z } from "zod";

import { FUTURES_CATALOG_PATH } from "../../../constants/endpoints.ts";
import { csvBoolean, csvRows, csvTimestamp } from "../../decode/csv.ts";
import { decodeLines } from "../../decode/lines.ts";
import { FUTURES_EXCHANGES, type FuturesExchange } from "../../market/exchanges.ts";
import { CatalogParams, type PreparedCatalogParams } from "./params.ts";

const futureProductSchema = z.strictObject({
  exchange: z.enum(FUTURES_EXCHANGES),
  coin: z.string().min(1),
  product: z.string().min(1),
  begin: csvTimestamp,
  depth: csvBoolean,
});

const delistedFutureProductSchema = z.strictObject({
  exchange: z.enum(FUTURES_EXCHANGES),
  coin: z.string().min(1),
  product: z.string().min(1),
  begin: csvTimestamp,
  end: csvTimestamp,
  depth: csvBoolean,
});

export type FutureProduct = z.output<typeof futureProductSchema> & {
  readonly end?: number;
};

export type FuturesCatalogParams = CatalogParams<FuturesExchange> & {
  readonly delisted?: boolean;

  /**
   * Keeps only rows whose `depth` flag matches.
   *
   * @remarks
   * The flag reflects live orderbook coverage, so `depth: true` combined with
   * `delisted: true` matches nothing in practice.
   */
  readonly depth?: boolean;
};

/** Validates and normalizes a futures catalog search. */
export function prepareFuturesCatalogParams(params: FuturesCatalogParams): PreparedCatalogParams {
  return CatalogParams.parse("futures", params, FUTURES_EXCHANGES, {
    delisted: true,
    depth: true,
  });
}

/**
 * Decodes a futures catalog response from its lines.
 *
 * @param lines - The response body's lines.
 * @param delisted - Whether the response is the delisted catalog, whose rows
 * carry an `end`.
 * @returns The products, in response order.
 */
export function decodeFuturesCatalogLines(
  lines: AsyncIterable<string>,
  delisted: boolean,
): AsyncIterable<FutureProduct> {
  const schema = delisted ? delistedFutureProductSchema : futureProductSchema;
  return decodeLines(lines, csvRows(schema), FUTURES_CATALOG_PATH);
}
