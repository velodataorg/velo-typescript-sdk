import { z } from "zod";

import { SPOT_CATALOG_PATH } from "../../../constants.js";
import { VeloError } from "../../../errors.js";
import { SPOT_EXCHANGES, type SpotExchange } from "../../../exchange.js";
import type { Http, HttpRequestOptions } from "../../../transport/http.js";
import { decode } from "../../decode/decode.js";
import { csvTimestamp } from "../../decode/schema.js";
import { filterCatalog, prepareCatalogParams } from "./params.js";
import type { CatalogParams } from "./params.js";

const SpotProductSchema = z.strictObject({
  exchange: z.enum(SPOT_EXCHANGES),
  coin: z.string().min(1),
  product: z.string().min(1),
  begin: csvTimestamp,
});

const DelistedSpotProductSchema = z.strictObject({
  exchange: z.enum(SPOT_EXCHANGES),
  coin: z.string().min(1),
  product: z.string().min(1),
  begin: csvTimestamp,
  end: csvTimestamp,
});

export type SpotProduct = z.output<typeof SpotProductSchema> & {
  readonly end?: number;
};

export type SpotCatalogParams = CatalogParams<SpotExchange> & {
  readonly delisted?: boolean;
};

export type SpotCatalog = (
  params?: SpotCatalogParams,
  options?: HttpRequestOptions,
) => Promise<SpotProduct[]>;

/**
 * Creates the spot product catalog bound to an HTTP transport.
 */
export function createSpotCatalog(http: Http): SpotCatalog {
  return (params: SpotCatalogParams = {}, options?: HttpRequestOptions) => {
    const prepared = prepareCatalogParams("spot", params, SPOT_EXCHANGES, true);
    return http
      .text(SPOT_CATALOG_PATH, { delisted: prepared.delisted ? 1 : 0 }, options)
      .then((body) => decodeSpotCatalog(body, prepared.delisted))
      .then((rows) => filterCatalog(rows, prepared));
  };
}

function decodeSpotCatalog(body: string, delisted: boolean): SpotProduct[] {
  try {
    return delisted ? decode(body, DelistedSpotProductSchema) : decode(body, SpotProductSchema);
  } catch (cause) {
    throw new VeloError(`Unexpected ${SPOT_CATALOG_PATH} response`, { cause });
  }
}
