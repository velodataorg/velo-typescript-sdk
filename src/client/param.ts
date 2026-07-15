import type {
  Exchange,
  FuturesColumn,
  OptionsColumn,
  MarketType,
  SpotColumn,
} from "../constants.js";
import type { HttpQuery } from "../transport/http.js";
import { assert } from "../util/assert.js";
import type { TimeRange } from "./align.js";
import type { Resolution } from "./resolution.js";
import { resolutionParams } from "./resolution.js";

export type ColumnFor<T extends MarketType> = {
  futures: FuturesColumn;
  options: OptionsColumn;
  spot: SpotColumn;
}[T];

interface QueryParamsBaseV1<T extends MarketType, C extends ColumnFor<T> = ColumnFor<T>> {
  /**
   * Exchanges to include; every exchange is combined with every product
   * (cross product). Required except for `3m_basis_ann` queries.
   */
  exchanges?: readonly Exchange[];
  /** Columns to return, canonical API names. Available values depend on the market. */
  columns: readonly C[];
  /** Start of the time range as a millisecond timestamp (inclusive). */
  begin: number;
  /** End of the time range as a millisecond timestamp (exclusive). */
  end: number;
  resolution: Resolution;
}

/** Selects by product symbol, e.g. "BTCUSDT". */
export interface QueryParamsProductsV1<
  T extends MarketType,
  C extends ColumnFor<T> = ColumnFor<T>,
> extends QueryParamsBaseV1<T, C> {
  products: readonly string[];
  coins?: never;
}

/** Selects by coin symbol, e.g. "BTC". */
export interface QueryParamsCoinsV1<
  T extends MarketType,
  C extends ColumnFor<T> = ColumnFor<T>,
> extends QueryParamsBaseV1<T, C> {
  coins: readonly string[];
  products?: never;
}

/**
 * Parameters for one market query. The market type comes from the namespace
 * that creates the query (`velo.futures` etc.), so `columns` narrows to the
 * values valid for that market, and selection is by `products` or `coins` —
 * never both.
 *
 * The mapped type distributes over MarketType, expanding to a six-way union
 * (products/coins × futures/options/spot) so each market is instantiated with
 * its own column set. `QueryParamsProductsV1<MarketType>` would instead pool
 * every market's columns together.
 */
export type QueryParamsV1 = {
  [T in MarketType]: QueryParamsProductsV1<T> | QueryParamsCoinsV1<T>;
}[MarketType];

/**
 * A query as resolved by its market namespace: the params plus the injected
 * market type, with every market's columns pooled. Runtime helpers take this
 * so they also accept `Market.query`'s generic params, whose unresolved type
 * parameters don't match the closed QueryParamsV1 union.
 */
export type ResolvedParamsV1 = { type: MarketType } & (
  | QueryParamsProductsV1<MarketType>
  | QueryParamsCoinsV1<MarketType>
);

const BASIS_COLUMN = "3m_basis_ann";

/**
 * Asserts the parameter rules the server enforces (velo-api-proxy getRows),
 * so a bad query fails at construction with a clear message instead of a 400
 * after a network round trip. The type system already guarantees most of this
 * for TypeScript callers; plain-JS callers get the same rules at runtime.
 * Time range and resolution are validated by alignRange/resolutionValue.
 */
export function validateQueryParams(params: ResolvedParamsV1): void {
  assert(params.columns.length > 0, "columns must not be empty");
  assert(!(params.products && params.coins), "choose products or coins, not both");
  const selector = params.products ?? params.coins;
  assert(selector !== undefined && selector.length > 0, "one of products or coins is required");

  if ((params.columns as readonly string[]).includes(BASIS_COLUMN)) {
    assert(params.type === "futures", `${BASIS_COLUMN} must be used with type futures`);
    assert(params.columns.length === 1, `${BASIS_COLUMN} must be used alone`);
    assert(params.coins !== undefined, `${BASIS_COLUMN} must be used with coins, not products`);
    assert(
      params.coins.every((coin) => coin === "BTC" || coin === "ETH"),
      `${BASIS_COLUMN} may only be used with coins BTC and ETH`,
    );
  } else {
    assert(
      params.exchanges !== undefined && params.exchanges.length > 0,
      `exchanges are required (may only be omitted for ${BASIS_COLUMN} queries)`,
    );
  }
}

/** The /rows wire query for one request, with `range` (usually aligned) taking over begin/end. */
export function rowsQueryParams(params: ResolvedParamsV1, range: TimeRange): HttpQuery {
  return {
    type: params.type,
    exchanges: params.exchanges,
    coins: params.coins,
    products: params.products,
    columns: params.columns,
    begin: range.begin,
    end: range.end,
    ...resolutionParams(params.resolution),
  };
}
