import type {
  Exchange,
  FuturesColumn,
  OptionsColumn,
  MarketType,
  SpotColumn,
} from "../constants.js";
import type { Resolution } from "../resolution/resolution.js";

export type Column<T extends MarketType> = {
  futures: FuturesColumn;
  options: OptionsColumn;
  spot: SpotColumn;
}[T];

interface QueryParamsBase<T extends MarketType, C extends Column<T> = Column<T>> {
  /**
   * Exchanges to include; every exchange is combined with every product
   * (cross product). Required except for `3m_basis_ann` queries.
   */
  readonly exchanges?: readonly Exchange[];
  /** Columns to return, canonical API names. Available values depend on the market. */
  readonly columns: readonly C[];
  /** Start of the time range as a millisecond timestamp (inclusive). */
  readonly begin: number;
  /** End of the time range as a millisecond timestamp (exclusive). */
  readonly end: number;
  readonly resolution: Resolution;
}

/** Selects by product symbol, e.g. "BTCUSDT". */
export interface QueryParamsProducts<
  T extends MarketType,
  C extends Column<T> = Column<T>,
> extends QueryParamsBase<T, C> {
  readonly products: readonly string[];
  readonly coins?: never;
}

/** Selects by coin symbol, e.g. "BTC". */
export interface QueryParamsCoins<
  T extends MarketType,
  C extends Column<T> = Column<T>,
> extends QueryParamsBase<T, C> {
  readonly coins: readonly string[];
  readonly products?: never;
}

/**
 * Parameters for one market query. The market type comes from the namespace
 * that creates the query (`velo.futures` etc.), so `columns` narrows to the
 * values valid for that market, and selection is by `products` or `coins` —
 * never both.
 *
 * The mapped type distributes over MarketType, expanding to a six-way union
 * (products/coins × futures/options/spot) so each market is instantiated with
 * its own column set. `QueryParamsProducts<MarketType>` would instead pool
 * every market's columns together.
 */
export type QueryParams = {
  [T in MarketType]: QueryParamsProducts<T> | QueryParamsCoins<T>;
}[MarketType];
