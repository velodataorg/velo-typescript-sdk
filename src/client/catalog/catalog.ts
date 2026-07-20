import { FUTURES_CATALOG_PATH, SPOT_CATALOG_PATH } from "../../constants.js";
import type { Http, RequestOptions } from "../../transport/http.js";
import { assert } from "../../util/assert.js";
import type { CsvSchema, FromSchema } from "../../util/csv.js";
import { decodeCsv } from "../../util/csv.js";
import type { Exchange, FuturesExchange, SpotExchange } from "../rows/types.js";
import { FUTURES_EXCHANGES, SPOT_EXCHANGES } from "../rows/types.js";

export type CatalogSearchParams<E extends Exchange = Exchange> =
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

export interface FutureProduct {
  exchange: FuturesExchange;
  coin: string;
  product: string;
  begin: number;
  depth: boolean;
}

export interface SpotProduct {
  exchange: SpotExchange;
  coin: string;
  product: string;
  begin: number;
}

export interface Catalog {
  /**
   * Fetches and searches the active futures catalog (`/api/v1/futures`).
   *
   * @param params - An optional coin or product selector, plus an optional exchange.
   * @param options - Per-request transport options.
   * @returns The matching active futures.
   * @throws Synchronously if params are invalid; rejects if the request or response is invalid.
   */
  futures(
    params?: CatalogSearchParams<FuturesExchange>,
    options?: RequestOptions,
  ): Promise<FutureProduct[]>;

  /**
   * Fetches and searches the active spot catalog (`/api/v1/spot`).
   *
   * @param params - An optional coin or product selector, plus an optional exchange.
   * @param options - Per-request transport options.
   * @returns The matching active spot products.
   * @throws Synchronously if params are invalid; rejects if the request or response is invalid.
   */
  spot(
    params?: CatalogSearchParams<SpotExchange>,
    options?: RequestOptions,
  ): Promise<SpotProduct[]>;
}

const FUTURES_CATALOG_SCHEMA = {
  exchange: "string",
  coin: "string",
  product: "string",
  begin: "number",
  depth: "boolean",
} as const satisfies CsvSchema;

const SPOT_CATALOG_SCHEMA = {
  exchange: "string",
  coin: "string",
  product: "string",
  begin: "number",
} as const satisfies CsvSchema;

type FutureProductWire = FromSchema<typeof FUTURES_CATALOG_SCHEMA>;
type SpotProductWire = FromSchema<typeof SPOT_CATALOG_SCHEMA>;

interface PreparedCatalogSearch {
  readonly coin?: string;
  readonly product?: string;
  readonly exchange?: string;
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
      const search = prepareCatalogSearch(params);
      return http
        .text(FUTURES_CATALOG_PATH, { delisted: 0 }, options)
        .then(decodeCatalogFutures)
        .then((rows) => filterCatalog(rows, search));
    },
    spot(params = {}, options) {
      const search = prepareCatalogSearch(params);
      return http
        .text(SPOT_CATALOG_PATH, { delisted: 0 }, options)
        .then(decodeCatalogSpot)
        .then((rows) => filterCatalog(rows, search));
    },
  };
}

/**
 * Validates and case-folds one catalog search without retaining caller-owned data.
 *
 * @param params - The public search params.
 * @returns The prepared search.
 * @throws If params are not an object, contain invalid fields, or select both coin and product.
 */
function prepareCatalogSearch(params: CatalogSearchParams): PreparedCatalogSearch {
  assert(
    params !== null && typeof params === "object" && !Array.isArray(params),
    "catalog search params must be an object",
  );

  const { coin, product, exchange } = params;
  assert(
    coin === undefined || product === undefined,
    "catalog search cannot specify both coin and product",
  );

  return {
    ...(coin === undefined ? {} : { coin: prepareFilter(coin, "coin") }),
    ...(product === undefined ? {} : { product: prepareFilter(product, "product") }),
    ...(exchange === undefined ? {} : { exchange: prepareFilter(exchange, "exchange") }),
  };
}

function prepareFilter(value: unknown, field: string): string {
  assert(
    typeof value === "string" && value !== "",
    () => `catalog search ${field} must be a non-empty string`,
  );
  return value.toLowerCase();
}

function decodeCatalogFutures(text: string): FutureProduct[] {
  const rows = decodeCsv(text, FUTURES_CATALOG_SCHEMA, FUTURES_CATALOG_PATH) as FutureProductWire[];

  return rows.map((row) => {
    assertExchange(row.exchange, FUTURES_EXCHANGES, FUTURES_CATALOG_PATH);
    assertBegin(row.begin, FUTURES_CATALOG_PATH);
    return { ...row, exchange: row.exchange };
  });
}

function decodeCatalogSpot(text: string): SpotProduct[] {
  const rows = decodeCsv(text, SPOT_CATALOG_SCHEMA, SPOT_CATALOG_PATH) as SpotProductWire[];

  return rows.map((row) => {
    assertExchange(row.exchange, SPOT_EXCHANGES, SPOT_CATALOG_PATH);
    assertBegin(row.begin, SPOT_CATALOG_PATH);
    return { ...row, exchange: row.exchange };
  });
}

function assertExchange<T extends string>(
  exchange: string,
  exchanges: readonly T[],
  path: string,
): asserts exchange is T {
  assert(
    exchanges.includes(exchange as T),
    () => `unexpected ${path} response: unknown exchange ${JSON.stringify(exchange)}`,
  );
}

function assertBegin(begin: number, path: string): void {
  assert(
    Number.isSafeInteger(begin) && begin >= 0,
    () =>
      `unexpected ${path} response: begin must be a nonnegative safe integer (got ${String(begin)})`,
  );
}

function filterCatalog<T extends FutureProduct | SpotProduct>(
  rows: T[],
  search: PreparedCatalogSearch,
): T[] {
  const { coin, product, exchange } = search;
  if (coin === undefined && product === undefined && exchange === undefined) return rows;

  return rows.filter(
    (row) =>
      (coin === undefined || row.coin.toLowerCase() === coin) &&
      (product === undefined || row.product.toLowerCase() === product) &&
      (exchange === undefined || row.exchange.toLowerCase() === exchange),
  );
}
