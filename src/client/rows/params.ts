import { assert, assertStringArray } from "../../util/assert.js";
import type { Column, MarketExchange, MarketType } from "./markets.js";
import {
  FUTURES_COLUMNS,
  FUTURES_EXCHANGES,
  MARKET_TYPES,
  OPTIONS_COLUMNS,
  OPTIONS_EXCHANGES,
  SPOT_COLUMNS,
  SPOT_EXCHANGES,
} from "./markets.js";
import type { Resolution } from "./resolution.js";

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
 * The mapped type distributes over {@link MarketType}, so the bare
 * `RowsParams` expands to a six-way union (products/coins ×
 * futures/options/spot) where each market is instantiated with its own
 * column set, instead of pooling every market's columns together.
 *
 * @typeParam T - The market the params query; defaults to any market.
 */
export type RowsParams<T extends MarketType = MarketType> = {
  [M in MarketType]: RowsParamsProducts<M> | RowsParamsCoins<M>;
}[T];

/* What the runtime helpers accept, deliberately pooled across markets:
 * columns and exchanges may come from any market, because the helpers are
 * written defensively against plain-JS input anyway — validateRowsParams is
 * what enforces the per-market rules.
 */
export type AnyRowsParams = RowsParamsProducts<MarketType> | RowsParamsCoins<MarketType>;

const BASIS_COLUMN = "3m_basis_ann";

/**
 * Whether the query selects the basis column, which the server validates and
 * prices specially.
 *
 * @param params - The params to inspect.
 * @returns True if `columns` includes `3m_basis_ann`.
 */
export function isBasisQuery(params: AnyRowsParams): boolean {
  return (params.columns as readonly string[]).includes(BASIS_COLUMN);
}

/* What the server accepts per market; anything else is a 400. */
const MARKET_COLUMNS: Record<MarketType, readonly string[]> = {
  futures: FUTURES_COLUMNS,
  options: OPTIONS_COLUMNS,
  spot: SPOT_COLUMNS,
};
const MARKET_EXCHANGES: Record<MarketType, readonly string[]> = {
  futures: FUTURES_EXCHANGES,
  options: OPTIONS_EXCHANGES,
  spot: SPOT_EXCHANGES,
};

/**
 * Asserts the parameter rules the server enforces (velo-api-proxy getRows),
 * so a bad query fails at construction with a clear message instead of a 400
 * after a network round trip.
 *
 * @remarks
 * The type system already guarantees most of this for TypeScript callers;
 * plain-JS callers get the same rules at runtime. Time range and resolution
 * are validated by the alignRange call in prepareRows.
 *
 * @param type - The market the query targets, from the namespace that
 * created it.
 * @param params - The params to validate.
 * @throws If the params break any of the server's rules.
 */
export function validateRowsParams(type: MarketType, params: AnyRowsParams): void {
  assert(
    (MARKET_TYPES as readonly string[]).includes(type),
    () => `invalid type ${JSON.stringify(type)}: expected one of ${MARKET_TYPES.join(", ")}`,
  );
  assertStringArray(params.columns, "columns");
  if (params.exchanges !== undefined) assertStringArray(params.exchanges, "exchanges");
  if (params.products !== undefined) assertStringArray(params.products, "products");
  if (params.coins !== undefined) assertStringArray(params.coins, "coins");
  assert(params.columns.length > 0, "columns must not be empty");
  assert(!(params.products && params.coins), "choose products or coins, not both");
  const selector = params.products ?? params.coins;
  assert(selector !== undefined && selector.length > 0, "one of products or coins is required");

  if (isBasisQuery(params)) {
    assert(type === "futures", `${BASIS_COLUMN} must be used with type futures`);
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
    const validColumns = MARKET_COLUMNS[type];
    for (const column of params.columns) {
      assert(
        validColumns.includes(column),
        () => `invalid column ${JSON.stringify(column)} for type ${type}`,
      );
    }
  }

  const validExchanges = MARKET_EXCHANGES[type];
  for (const exchange of params.exchanges ?? []) {
    assert(
      validExchanges.includes(exchange),
      () =>
        `invalid exchange ${JSON.stringify(exchange)} for type ${type}: ` +
        `expected one of ${validExchanges.join(", ")}`,
    );
  }
}
