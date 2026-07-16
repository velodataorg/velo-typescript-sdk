import { ROWS_PATH } from "../../constants.js";
import type { HttpParams } from "../../transport/http.js";
import { assert, assertStringArray } from "../../util/assert.js";
import type { PreparedParams } from "../query.js";
import type { TimeRange } from "./align.js";
import { alignRange } from "./align.js";
import { chunkRange } from "./chunk.js";
import type { AnyRowsParams, RowsParamsCoins, RowsParamsProducts } from "./params.js";
import type { Resolution } from "./resolution.js";
import { toResolutionValue } from "./resolution.js";
import type { Row } from "./result.js";
import { ROWS_BASE_SCHEMA } from "./result.js";
import type { Column, MarketType } from "./types.js";
import { MARKET_COLUMNS, MARKET_EXCHANGES, MARKET_TYPES } from "./types.js";
import { BASIS_COLUMN, isBasisQuery } from "./util.js";

/**
 * Validates and lowers a /rows query: params in, wire requests and the
 * response schema out.
 *
 * @remarks
 * `begin`/`end` are aligned to whole resolution buckets (begin floors, end
 * ceils), and ranges exceeding the server's per-request budget are split
 * into one request per chunk — all eagerly, so every invalid query fails
 * here, before anything is sent.
 *
 * @param type - The market the query targets, from the namespace that
 * created it.
 * @param params - The query params.
 * @returns The prepared query.
 * @throws If the params fail validation, or describe a query too wide to fit
 * even one bucket within the server's request budget.
 */
export function prepareRows<T extends MarketType, C extends Column<T>>(
  type: T,
  params: RowsParamsProducts<T, C> | RowsParamsCoins<T, C>,
): PreparedParams<Row<C>> {
  validateRowsParams(type, params);
  // Copy the caller's arrays once: the wire requests are built from the
  // copies, so mutating the originals after preparation cannot change what
  // is sent — and the Query constructor freezes the copies, never the
  // caller's arrays.
  // Branch on the selector so each arm builds one closed variant of the union.
  const copies = {
    columns: [...params.columns],
    ...(params.exchanges && { exchanges: [...params.exchanges] }),
  };
  const sealed: AnyRowsParams =
    params.coins !== undefined
      ? { ...params, ...copies, coins: [...params.coins] }
      : { ...params, ...copies, products: [...params.products] };

  const range = alignRange({ begin: params.begin, end: params.end }, params.resolution);
  return {
    path: ROWS_PATH,
    requests: chunkRange(sealed, range).map((step) => toHttpParams(type, sealed, step)),
    schema: {
      ...ROWS_BASE_SCHEMA,
      ...Object.fromEntries(sealed.columns.map((column) => [column, "nullable-number"] as const)),
    },
  };
}

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

/**
 * Builds the /rows wire query for one request.
 *
 * @param type - The market the query targets.
 * @param params - The validated query params.
 * @param range - The begin/end actually sent (aligned and chunked), taking
 * over the params' own begin/end.
 * @returns The HTTP params for one request.
 */
function toHttpParams(type: MarketType, params: AnyRowsParams, range: TimeRange): HttpParams {
  return {
    type,
    exchanges: params.exchanges,
    coins: params.coins,
    products: params.products,
    columns: params.columns,
    begin: range.begin,
    end: range.end,
    ...toResolutionParams(params.resolution),
  };
}

/* The /rows wire form of a resolution. */
export interface ResolutionParams {
  resolution: number;
  months?: boolean;
}

/**
 * Converts a resolution to its /rows wire form.
 *
 * @param resolution - The resolution to convert.
 * @returns Minutes, or a month count with `months: true`.
 */
export function toResolutionParams(resolution: Resolution): ResolutionParams {
  const value = toResolutionValue(resolution);
  if (value.unit === "months") return { resolution: value.count, months: true };
  return { resolution: value.count };
}
