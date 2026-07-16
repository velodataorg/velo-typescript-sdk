import type { MarketType } from "../constants.js";
import {
  FUTURES_COLUMNS,
  FUTURES_EXCHANGES,
  MARKET_TYPES,
  OPTIONS_COLUMNS,
  OPTIONS_EXCHANGES,
  SPOT_COLUMNS,
  SPOT_EXCHANGES,
} from "../constants.js";
import type { TimeRange } from "../resolution/align.js";
import type { Resolution } from "../resolution/resolution.js";
import { resolutionValue } from "../resolution/resolution.js";
import type { HttpParams } from "../transport/http.js";
import { assert } from "../util/assert.js";
import type { QueryParamsCoins, QueryParamsProducts } from "./query-params.js";

/* The params sent to /api/v1/rows: the user's QueryParams plus the market
 * type. Deliberately looser than QueryParams:
 * - columns may come from any market
 * - runtime helpers don't care which market the query is for
 */
export type RowsParams = { readonly type: MarketType } & (
  | QueryParamsProducts<MarketType>
  | QueryParamsCoins<MarketType>
);

const BASIS_COLUMN = "3m_basis_ann";

/**
 * Whether the query selects the basis column, which the server validates and
 * prices specially.
 *
 * @param params - The params to inspect.
 * @returns True if `columns` includes `3m_basis_ann`.
 */
export function isBasisQuery(params: RowsParams): boolean {
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
 * Asserts a params field is really an array of non-empty strings — plain-JS
 * callers can pass anything, and a bare string would otherwise slip past the
 * length checks and be spread into characters.
 *
 * @param value - The field value to check.
 * @param field - The field name, for the failure message.
 * @throws If `value` is not an array of non-empty strings.
 */
function assertStringArray(value: unknown, field: string): void {
  assert(Array.isArray(value), () => `${field} must be an array (got ${typeof value})`);
  // for..of observes holes as undefined; array callbacks like every() skip
  // them, which would let a sparse array through unchecked.
  for (const item of value) {
    assert(
      typeof item === "string" && item !== "",
      () => `${field} must contain only non-empty strings`,
    );
  }
}

/**
 * Asserts the parameter rules the server enforces (velo-api-proxy getRows),
 * so a bad query fails at construction with a clear message instead of a 400
 * after a network round trip.
 *
 * @remarks
 * The type system already guarantees most of this for TypeScript callers;
 * plain-JS callers get the same rules at runtime. Time range and resolution
 * are validated by the alignRange call in the Query constructor.
 *
 * @param params - The params to validate.
 * @throws If the params break any of the server's rules.
 */
export function validateRowsParams(params: RowsParams): void {
  assert(
    (MARKET_TYPES as readonly string[]).includes(params.type),
    () => `invalid type ${JSON.stringify(params.type)}: expected one of ${MARKET_TYPES.join(", ")}`,
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
    const validColumns = MARKET_COLUMNS[params.type];
    for (const column of params.columns) {
      assert(
        validColumns.includes(column),
        () => `invalid column ${JSON.stringify(column)} for type ${params.type}`,
      );
    }
  }

  const validExchanges = MARKET_EXCHANGES[params.type];
  for (const exchange of params.exchanges ?? []) {
    assert(
      validExchanges.includes(exchange),
      () =>
        `invalid exchange ${JSON.stringify(exchange)} for type ${params.type}: ` +
        `expected one of ${validExchanges.join(", ")}`,
    );
  }
}

/**
 * Converts a resolution to its /rows wire form.
 *
 * @param resolution - The resolution to convert.
 * @returns Minutes, or a month count with `months: true`.
 */
export function resolutionParams(resolution: Resolution): { resolution: number; months?: boolean } {
  const value = resolutionValue(resolution);
  if (value.unit === "months") return { resolution: value.count, months: true };
  return { resolution: value.count };
}

/**
 * Builds the /rows wire query for one request.
 *
 * @param params - The validated query params.
 * @param range - The begin/end actually sent (usually aligned), taking over
 * the params' own begin/end.
 * @returns The HTTP params for one request.
 */
export function toHttpParams(params: RowsParams, range: TimeRange): HttpParams {
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
