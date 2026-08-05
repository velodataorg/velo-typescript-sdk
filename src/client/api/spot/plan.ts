import type { DataResult } from "../../data/data.ts";
import type { SpotColumn } from "../../market/columns.ts";
import type { SpotExchange } from "../../market/exchanges.ts";
import type { QueryPlan } from "../../query/query.ts";
import { planRows } from "../../rows/plan.ts";
import { SpotParams, type SpotRow } from "./params.ts";

/** Plans a spot rows query. */
export function planSpotRows<C extends SpotColumn, E extends SpotExchange>(
  params: SpotParams<C, E>,
): QueryPlan<SpotRow<C, E>, DataResult<E, C>> {
  const parsed = SpotParams.parse(params);
  /* Validation guarantees a non-empty exchange selection. */
  const responseExchanges = parsed.exchanges as readonly [E, ...E[]];
  return planRows("spot", parsed, responseExchanges);
}
