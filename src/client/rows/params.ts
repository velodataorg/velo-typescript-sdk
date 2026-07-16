import type { Resolution } from "./resolution.js";
import type { Column, MarketExchange, MarketType } from "./types.js";

interface RowsParamsBase<T extends MarketType, C extends Column<T> = Column<T>> {
  /* Exchanges to include; every exchange is combined with every product
   * (cross product). Required except for `3m_basis_ann` queries.
   */
  readonly exchanges?: readonly MarketExchange<T>[];
  /* Columns to return, canonical API names. Available values depend on the market. */
  readonly columns: readonly C[];
  /* Start of the time range as a millisecond timestamp (inclusive). */
  readonly begin: number;
  /* End of the time range as a millisecond timestamp (exclusive). */
  readonly end: number;
  /* Bucket length of the returned rows. */
  readonly resolution: Resolution;
}

/* Selects by product symbol, e.g. "BTCUSDT". */
export interface RowsParamsProducts<
  T extends MarketType,
  C extends Column<T> = Column<T>,
> extends RowsParamsBase<T, C> {
  readonly products: readonly string[];
  readonly coins?: never;
}

/* Selects by coin symbol, e.g. "BTC". */
export interface RowsParamsCoins<
  T extends MarketType,
  C extends Column<T> = Column<T>,
> extends RowsParamsBase<T, C> {
  readonly coins: readonly string[];
  readonly products?: never;
}

/**
 * Parameters for one market-data query (`/api/v1/rows`).
 *
 * @remarks
 * The market type comes from the namespace that creates the query
 * (`velo.futures` etc.), so `columns` narrows to the values valid for that
 * market, and selection is by `products` or `coins` — never both.
 *
 * The bare `RowsParams` pools columns and exchanges across markets. The
 * runtime helpers accept it because they are written defensively against
 * plain-JS input anyway — validateRowsParams is what enforces the
 * per-market rules.
 *
 * @typeParam T - The market the params query; defaults to any market.
 * @typeParam C - The requested columns; `query()` and `prepareRows` infer it
 * from `columns` to type the resulting rows. Defaults to every column of the
 * market.
 */
export type RowsParams<T extends MarketType = MarketType, C extends Column<T> = Column<T>> =
  | RowsParamsProducts<T, C>
  | RowsParamsCoins<T, C>;
