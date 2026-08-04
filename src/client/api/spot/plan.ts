import type { DataResult } from "../../common/data/data.ts";
import type { SpotColumn } from "../../common/market/columns.ts";
import type { SpotExchange } from "../../common/market/exchanges.ts";
import type { QueryPlan } from "../../common/query.ts";
import { planRows } from "../../common/rows/plan.ts";
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
