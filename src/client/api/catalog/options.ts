import { z } from "zod";

import { OPTIONS_CATALOG_PATH } from "../../../constants/endpoints.ts";
import { VeloError } from "../../../errors.ts";
import { csvTimestamp, decode } from "../../common/decode/csv.ts";
import { OPTIONS_EXCHANGES, type OptionsExchange } from "../../common/market/exchanges.ts";
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

/** Decodes an options catalog response. */
export function decodeOptionsCatalog(body: string): OptionProduct[] {
  try {
    return decode(body, optionProductSchema);
  } catch (cause) {
    throw new VeloError(`Unexpected ${OPTIONS_CATALOG_PATH} response`, { cause });
  }
}
