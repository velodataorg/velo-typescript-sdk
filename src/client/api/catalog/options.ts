import { z } from "zod";

import { OPTIONS_CATALOG_PATH } from "../../../constants/endpoints.ts";
import { csvRows, csvTimestamp } from "../../decode/csv.ts";
import { decodeLines } from "../../decode/lines.ts";
import { OPTIONS_EXCHANGES, type OptionsExchange } from "../../market/exchanges.ts";
import { CatalogParams, type PreparedCatalogParams } from "./params.ts";

const optionProductSchema = z.strictObject({
  exchange: z.enum(OPTIONS_EXCHANGES),
  coin: z.string().min(1),
  product: z.string().min(1),
  begin: csvTimestamp,
});

export type OptionProduct = z.output<typeof optionProductSchema>;
export type OptionsCatalogParams = CatalogParams<OptionsExchange>;

/** Validates and normalizes an options catalog search. */
export function prepareOptionsCatalogParams(params: OptionsCatalogParams): PreparedCatalogParams {
  return CatalogParams.parse("options", params, OPTIONS_EXCHANGES, {
    delisted: false,
    depth: false,
  });
}

/**
 * Decodes an options catalog response from its lines.
 *
 * @param lines - The response body's lines.
 * @returns The products, in response order.
 */
export function decodeOptionsCatalogLines(
  lines: AsyncIterable<string>,
): AsyncIterable<OptionProduct> {
  return decodeLines(lines, csvRows(optionProductSchema), OPTIONS_CATALOG_PATH);
}
