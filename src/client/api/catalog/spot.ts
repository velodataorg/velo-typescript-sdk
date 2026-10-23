import { z } from "zod";

import { SPOT_CATALOG_PATH } from "../../../constants/endpoints.ts";
import { csvRows, csvTimestamp } from "../../decode/csv.ts";
import { decodeLines } from "../../decode/lines.ts";
import { SPOT_EXCHANGES, type SpotExchange } from "../../market/exchanges.ts";
import { CatalogParams, type PreparedCatalogParams } from "./params.ts";

const spotProductSchema = z.strictObject({
  exchange: z.enum(SPOT_EXCHANGES),
  coin: z.string().min(1),
  product: z.string().min(1),
  begin: csvTimestamp,
});

const delistedSpotProductSchema = z.strictObject({
  exchange: z.enum(SPOT_EXCHANGES),
  coin: z.string().min(1),
  product: z.string().min(1),
  begin: csvTimestamp,
  end: csvTimestamp,
});

export type SpotProduct = z.output<typeof spotProductSchema> & {
  readonly end?: number;
};

export type SpotCatalogParams = CatalogParams<SpotExchange> & {
  readonly delisted?: boolean;
};

/** Validates and normalizes a spot catalog search. */
export function prepareSpotCatalogParams(params: SpotCatalogParams): PreparedCatalogParams {
  return CatalogParams.parse("spot", params, SPOT_EXCHANGES, {
    delisted: true,
    depth: false,
  });
}

/**
 * Decodes a spot catalog response from its lines.
 *
 * @param lines - The response body's lines.
 * @param delisted - Whether the response is the delisted catalog, whose rows
 * carry an `end`.
 * @returns The products, in response order.
 */
export function decodeSpotCatalogLines(
  lines: AsyncIterable<string>,
  delisted: boolean,
): AsyncIterable<SpotProduct> {
  const schema = delisted ? delistedSpotProductSchema : spotProductSchema;
  return decodeLines(lines, csvRows(schema), SPOT_CATALOG_PATH);
}
