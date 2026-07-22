import { z } from "zod";

import { FUTURES_CATALOG_PATH } from "../../../constants/endpoints.js";
import { VeloError } from "../../../errors.js";
import type { Http, HttpRequestOptions } from "../../../transport/http.js";
import { csvBoolean, csvTimestamp, decode } from "../../common/decode/csv.js";
import { FUTURES_EXCHANGES, type FuturesExchange } from "../../common/market/exchanges.js";
import { CatalogParams } from "./params.js";

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
};

/** Fetches validated futures product catalogs bound to an HTTP transport. */
export class FuturesCatalogQuery {
  readonly #http: Http;

  constructor(http: Http) {
    this.#http = http;
  }

  /** Fetches the futures product catalog from raw parameters. */
  build(params: FuturesCatalogParams = {}, options?: HttpRequestOptions): Promise<FutureProduct[]> {
    const prepared = CatalogParams.parse("futures", params, FUTURES_EXCHANGES, true);
    return this.#http
      .text(FUTURES_CATALOG_PATH, { delisted: prepared.delisted ? 1 : 0 }, options)
      .then((body) => this.#decodeFuturesCatalog(body, prepared.delisted))
      .then((rows) => CatalogParams.filter(rows, prepared));
  }

  #decodeFuturesCatalog(body: string, delisted: boolean): FutureProduct[] {
    try {
      return delisted
        ? decode(body, delistedFutureProductSchema)
        : decode(body, futureProductSchema);
    } catch (cause) {
      throw new VeloError(`Unexpected ${FUTURES_CATALOG_PATH} response`, { cause });
    }
  }
}
