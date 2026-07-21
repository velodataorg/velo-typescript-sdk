import { z } from "zod";

import { OPTIONS_CATALOG_PATH } from "../../constants.js";
import { decode } from "../../decode/decode.js";
import { timestamp } from "../../decode/types.js";
import { VeloError } from "../../errors.js";
import type { Http, HttpRequestOptions } from "../../transport/http.js";
import { OPTIONS_EXCHANGES } from "../rows/options/options.js";
import type { OptionsExchange } from "../rows/options/options.js";
import { filterCatalog, prepareCatalogParams } from "./params.js";
import type { CatalogParams } from "./params.js";

const OptionProductSchema = z.strictObject({
  exchange: z.enum(OPTIONS_EXCHANGES),
  coin: z.string().min(1),
  product: z.string().min(1),
  begin: timestamp,
});

export type OptionProduct = z.output<typeof OptionProductSchema>;
export type OptionsCatalogParams = CatalogParams<OptionsExchange>;
export type OptionsCatalog = (
  params?: OptionsCatalogParams,
  options?: HttpRequestOptions,
) => Promise<OptionProduct[]>;

/**
 * Creates the options product catalog bound to an HTTP transport.
 */
export function createOptionsCatalog(http: Http): OptionsCatalog {
  return (params = {}, options) => {
    const prepared = prepareCatalogParams("options", params, OPTIONS_EXCHANGES, false);
    return http
      .text(OPTIONS_CATALOG_PATH, { delisted: 0 }, options)
      .then(decodeOptionsCatalog)
      .then((rows) => filterCatalog(rows, prepared));
  };
}

function decodeOptionsCatalog(body: string): OptionProduct[] {
  try {
    return decode(body, OptionProductSchema);
  } catch (cause) {
    throw new VeloError(`Unexpected ${OPTIONS_CATALOG_PATH} response`, { cause });
  }
}
