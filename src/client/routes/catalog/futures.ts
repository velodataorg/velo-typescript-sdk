import { z } from "zod";

import { FUTURES_CATALOG_PATH } from "../../../constants.js";
import { VeloError } from "../../../errors.js";
import { FUTURES_EXCHANGES, type FuturesExchange } from "../../../exchange.js";
import type { Http, HttpRequestOptions } from "../../../transport/http.js";
import { decode } from "../../decode/decode.js";
import { csvBoolean, csvTimestamp } from "../../decode/schema.js";
import { filterCatalog, prepareCatalogParams } from "./params.js";
import type { CatalogParams } from "./params.js";

const FutureProductSchema = z.strictObject({
  exchange: z.enum(FUTURES_EXCHANGES),
  coin: z.string().min(1),
  product: z.string().min(1),
  begin: csvTimestamp,
  depth: csvBoolean,
});

const DelistedFutureProductSchema = z.strictObject({
  exchange: z.enum(FUTURES_EXCHANGES),
  coin: z.string().min(1),
  product: z.string().min(1),
  begin: csvTimestamp,
  end: csvTimestamp,
  depth: csvBoolean,
});

export type FutureProduct = z.output<typeof FutureProductSchema> & {
  readonly end?: number;
};

export type FuturesCatalogParams = CatalogParams<FuturesExchange> & {
  readonly delisted?: boolean;
};

export type FuturesCatalog = (
  params?: FuturesCatalogParams,
  options?: HttpRequestOptions,
) => Promise<FutureProduct[]>;

/**
 * Creates the futures product catalog bound to an HTTP transport.
 */
export function createFuturesCatalog(http: Http): FuturesCatalog {
  return (params: FuturesCatalogParams = {}, options?: HttpRequestOptions) => {
    const prepared = prepareCatalogParams("futures", params, FUTURES_EXCHANGES, true);
    return http
      .text(FUTURES_CATALOG_PATH, { delisted: prepared.delisted ? 1 : 0 }, options)
      .then((body) => decodeFuturesCatalog(body, prepared.delisted))
      .then((rows) => filterCatalog(rows, prepared));
  };
}

function decodeFuturesCatalog(body: string, delisted: boolean): FutureProduct[] {
  try {
    return delisted ? decode(body, DelistedFutureProductSchema) : decode(body, FutureProductSchema);
  } catch (cause) {
    throw new VeloError(`Unexpected ${FUTURES_CATALOG_PATH} response`, { cause });
  }
}
