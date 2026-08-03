import { z } from "zod";

import { OPTIONS_CATALOG_PATH } from "../../../constants/endpoints.ts";
import { VeloError } from "../../../errors.ts";
import type { Http, HttpRequestOptions } from "../../../transport/http.ts";
import { csvTimestamp, decode } from "../../common/decode/csv.ts";
import { OPTIONS_EXCHANGES, type OptionsExchange } from "../../common/market/exchanges.ts";
import { CatalogParams } from "./params.ts";

const optionProductSchema = z.strictObject({
  exchange: z.enum(OPTIONS_EXCHANGES),
  coin: z.string().min(1),
  product: z.string().min(1),
  begin: csvTimestamp,
});

export type OptionProduct = z.output<typeof optionProductSchema>;
export type OptionsCatalogParams = CatalogParams<OptionsExchange>;

/** Fetches validated options product catalogs bound to an HTTP transport. */
export class OptionsCatalogQuery {
  readonly #http: Http;

  constructor(http: Http) {
    this.#http = http;
  }

  /** Fetches the options product catalog from raw parameters. */
  build(params: OptionsCatalogParams = {}, options?: HttpRequestOptions): Promise<OptionProduct[]> {
    const prepared = CatalogParams.parse("options", params, OPTIONS_EXCHANGES, {
      delisted: false,
      depth: false,
    });
    return this.#http
      .text(OPTIONS_CATALOG_PATH, { delisted: 0 }, options)
      .then((body) => this.#decodeOptionsCatalog(body))
      .then((rows) => CatalogParams.filter(rows, prepared));
  }

  #decodeOptionsCatalog(body: string): OptionProduct[] {
    try {
      return decode(body, optionProductSchema);
    } catch (cause) {
      throw new VeloError(`Unexpected ${OPTIONS_CATALOG_PATH} response`, { cause });
    }
  }
}
