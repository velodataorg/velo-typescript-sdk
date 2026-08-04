import { z } from "zod";

import { SPOT_CATALOG_PATH } from "../../../constants/endpoints.ts";
import { VeloError } from "../../../errors.ts";
import { csvTimestamp, decode, decodeLines } from "../../common/decode/csv.ts";
import { SPOT_EXCHANGES, type SpotExchange } from "../../common/market/exchanges.ts";
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

export async function* decodeSpotCatalogLines(
  lines: AsyncIterable<string>,
  delisted: boolean,
): AsyncGenerator<SpotProduct> {
  try {
    yield* decodeLines(lines, delisted ? delistedSpotProductSchema : spotProductSchema);
  } catch (cause) {
    throw new VeloError(`Unexpected ${SPOT_CATALOG_PATH} response`, { cause });
  }
}

/** Decodes a spot catalog response using its active or delisted wire shape. */
export function decodeSpotCatalog(body: string, delisted: boolean): SpotProduct[] {
  try {
    return delisted ? decode(body, delistedSpotProductSchema) : decode(body, spotProductSchema);
  } catch (cause) {
    throw new VeloError(`Unexpected ${SPOT_CATALOG_PATH} response`, { cause });
  }
}
