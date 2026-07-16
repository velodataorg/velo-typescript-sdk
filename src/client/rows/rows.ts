import { ROWS_PATH } from "../../constants.js";
import type { HttpParams } from "../../transport/http.js";
import type { PreparedParams } from "../query.js";
import type { TimeRange } from "./align.js";
import { alignRange } from "./align.js";
import { chunkRange } from "./chunk.js";
import type { Column, MarketType } from "./markets.js";
import type { AnyRowsParams, RowsParamsCoins, RowsParamsProducts } from "./params.js";
import { validateRowsParams } from "./params.js";
import type { Resolution } from "./resolution.js";
import { resolutionValue } from "./resolution.js";
import type { Row } from "./result.js";
import { ROWS_BASE_SCHEMA } from "./result.js";

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
    ...resolutionParams(params.resolution),
  };
}

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
