import { z } from "zod";

import { OPTIONS_CATALOG_PATH } from "../../../constants.js";
import { VeloError } from "../../../errors.js";
import { OPTIONS_EXCHANGES, type OptionsExchange } from "../../../exchange.js";
import type { Http, HttpRequestOptions } from "../../../transport/http.js";
import { decode } from "../../decode/decode.js";
import { csvTimestamp } from "../../decode/schema.js";
import { CatalogParams } from "./params.js";

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
    const prepared = CatalogParams.parse("options", params, OPTIONS_EXCHANGES, false);
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
