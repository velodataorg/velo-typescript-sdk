import { FUTURES_CATALOG_PATH, SPOT_CATALOG_PATH } from "../../constants.js";
import type { Http, RequestOptions } from "../../transport/http.js";
import { parseCsv } from "../../util/csv.js";
import type { Exchange, FuturesExchange, SpotExchange } from "../rows/types.js";
import { FutureProductSchema, SpotProductSchema } from "./schema.js";
import type { FutureProduct, SpotProduct } from "./schema.js";

export type { FutureProduct, SpotProduct } from "./schema.js";

export type CatalogParams<E extends Exchange = Exchange> =
  | {
      readonly coin: string;
      readonly product?: never;
      readonly exchange?: E;
    }
  | {
      readonly product: string;
      readonly coin?: never;
      readonly exchange?: E;
    }
  | {
      readonly coin?: never;
      readonly product?: never;
      readonly exchange?: E;
    };

export interface Catalog {
  /**
   * Fetches and searches the active futures catalog (`/api/v1/futures`).
   *
   * @param params - An optional coin or product selector, plus an optional exchange.
   * @param options - Per-request transport options.
   * @returns The matching active futures.
   * @throws Rejects if the request or response is invalid.
   */
  futures(
    params?: CatalogParams<FuturesExchange>,
    options?: RequestOptions,
  ): Promise<FutureProduct[]>;

  /**
   * Fetches and searches the active spot catalog (`/api/v1/spot`).
   *
   * @param params - An optional coin or product selector, plus an optional exchange.
   * @param options - Per-request transport options.
   * @returns The matching active spot products.
   * @throws Rejects if the request or response is invalid.
   */
  spot(params?: CatalogParams<SpotExchange>, options?: RequestOptions): Promise<SpotProduct[]>;
}

/**
 * Binds the product catalog to an HTTP transport.
 *
 * @param http - The authenticated HTTP transport.
 * @returns The stable catalog namespace.
 */
export function createCatalog(http: Http): Catalog {
  return {
    futures(params = {}, options) {
      return http
        .text(FUTURES_CATALOG_PATH, { delisted: 0 }, options)
        .then(decodeCatalogFutures)
        .then((rows) => filterCatalog(rows, params));
    },
    spot(params = {}, options) {
      return http
        .text(SPOT_CATALOG_PATH, { delisted: 0 }, options)
        .then(decodeCatalogSpot)
        .then((rows) => filterCatalog(rows, params));
    },
  };
}

function decodeCatalogFutures(text: string): FutureProduct[] {
  return parseCsv(text, FutureProductSchema, FUTURES_CATALOG_PATH);
}

function decodeCatalogSpot(text: string): SpotProduct[] {
  return parseCsv(text, SpotProductSchema, SPOT_CATALOG_PATH);
}

function filterCatalog<T extends FutureProduct | SpotProduct>(
  rows: T[],
  params: CatalogParams,
): T[] {
  const { coin, product, exchange } = params;
  if (coin === undefined && product === undefined && exchange === undefined) return rows;

  const normalizedCoin = coin?.toLowerCase();
  const normalizedProduct = product?.toLowerCase();
  const normalizedExchange = exchange?.toLowerCase();

  return rows.filter(
    (row) =>
      (normalizedCoin === undefined || row.coin.toLowerCase() === normalizedCoin) &&
      (normalizedProduct === undefined || row.product.toLowerCase() === normalizedProduct) &&
      (normalizedExchange === undefined || row.exchange.toLowerCase() === normalizedExchange),
  );
}
