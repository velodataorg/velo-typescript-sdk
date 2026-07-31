import { z } from "zod";

import { SPOT_CATALOG_PATH } from "../../../constants/endpoints.js";
import { VeloError } from "../../../errors.js";
import type { Http, HttpRequestOptions } from "../../../transport/http.js";
import { csvTimestamp, decode } from "../../common/decode/csv.js";
import { SPOT_EXCHANGES, type SpotExchange } from "../../common/market/exchanges.js";
import { CatalogParams } from "./params.js";

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

/** Fetches validated spot product catalogs bound to an HTTP transport. */
export class SpotCatalogQuery {
  readonly #http: Http;

  constructor(http: Http) {
    this.#http = http;
  }

  /** Fetches the spot product catalog from raw parameters. */
  build(params: SpotCatalogParams = {}, options?: HttpRequestOptions): Promise<SpotProduct[]> {
    const prepared = CatalogParams.parse("spot", params, SPOT_EXCHANGES, {
      delisted: true,
      depth: false,
    });
    return this.#http
      .text(SPOT_CATALOG_PATH, { delisted: prepared.delisted ? 1 : 0 }, options)
      .then((body) => this.#decodeSpotCatalog(body, prepared.delisted))
      .then((rows) => CatalogParams.filter(rows, prepared));
  }

  #decodeSpotCatalog(body: string, delisted: boolean): SpotProduct[] {
    try {
      return delisted ? decode(body, delistedSpotProductSchema) : decode(body, spotProductSchema);
    } catch (cause) {
      throw new VeloError(`Unexpected ${SPOT_CATALOG_PATH} response`, { cause });
    }
  }
}
