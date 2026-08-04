import { z } from "zod";

import { FUTURES_CATALOG_PATH } from "../../../constants/endpoints.ts";
import { VeloError } from "../../../errors.ts";
import { csvBoolean, csvTimestamp, decode, decodeLines } from "../../common/decode/csv.ts";
import { FUTURES_EXCHANGES, type FuturesExchange } from "../../common/market/exchanges.ts";
import { CatalogParams, type PreparedCatalogParams } from "./params.ts";

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

  /**
   * Keeps only rows whose `depth` flag matches.
   *
   * @remarks
   * The flag reflects live orderbook coverage, so `depth: true` combined with
   * `delisted: true` matches nothing in practice.
   */
  readonly depth?: boolean;
};

/** Validates and normalizes a futures catalog search. */
export function prepareFuturesCatalogParams(params: FuturesCatalogParams): PreparedCatalogParams {
  return CatalogParams.parse("futures", params, FUTURES_EXCHANGES, {
    delisted: true,
    depth: true,
  });
}

export async function* decodeFuturesCatalogLines(
  lines: AsyncIterable<string>,
  delisted: boolean,
): AsyncGenerator<FutureProduct> {
  try {
    yield* decodeLines(lines, delisted ? delistedFutureProductSchema : futureProductSchema);
  } catch (cause) {
    throw new VeloError(`Unexpected ${FUTURES_CATALOG_PATH} response`, { cause });
  }
}

/** Decodes a futures catalog response using its active or delisted wire shape. */
export function decodeFuturesCatalog(body: string, delisted: boolean): FutureProduct[] {
  try {
    return delisted ? decode(body, delistedFutureProductSchema) : decode(body, futureProductSchema);
  } catch (cause) {
    throw new VeloError(`Unexpected ${FUTURES_CATALOG_PATH} response`, { cause });
  }
}
