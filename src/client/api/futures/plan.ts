import type { DataResult } from "../../data/data.ts";
import { BASIS_COLUMN, type FuturesStandardColumn } from "../../market/columns.ts";
import { FUTURES_EXCHANGES, type FuturesExchange } from "../../market/exchanges.ts";
import type { QueryPlan } from "../../query/query.ts";
import { planRows } from "../../rows/plan.ts";
import {
  FuturesBasisParams,
  type FuturesBasisParams as FuturesBasisParamsType,
  type FuturesRow,
  FuturesStandardParams,
  type FuturesStandardParams as FuturesStandardParamsType,
} from "./params.ts";

/** Plans a standard futures rows query. */
export function planFuturesRows<C extends FuturesStandardColumn, E extends FuturesExchange>(
  params: FuturesStandardParamsType<C, E>,
): QueryPlan<FuturesRow<C, E>, DataResult<E, C>> {
  const parsed = FuturesStandardParams.parse(params);
  /* Validation guarantees a non-empty exchange selection. */
  const responseExchanges = parsed.exchanges as readonly [E, ...E[]];
  return planRows("futures", parsed, responseExchanges);
}

/** Plans the annualized three-month futures basis query. */
export function planFuturesBasis(
  params: FuturesBasisParamsType,
): QueryPlan<FuturesRow<typeof BASIS_COLUMN>, DataResult<FuturesExchange, typeof BASIS_COLUMN>> {
  const parsed = FuturesBasisParams.parse(params);
  return planRows("futures", parsed, FUTURES_EXCHANGES);
}
