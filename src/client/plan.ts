import { assert } from "../util/assert.ts";
import type { OrderbookData, OrderbookRow } from "./api/orderbook/data.ts";
import type { OrderbookParams } from "./api/orderbook/params.ts";
import { planOrderbook } from "./api/orderbook/plan.ts";
import type { QueryPlan } from "./common/query.ts";

/** Endpoint contracts understood by the central query planner. */
export interface QueryDefinitions {
  "orderbook.levels": {
    params: OrderbookParams;
    item: OrderbookRow;
    result: OrderbookData;
  };
}

/** A query endpoint handled by {@link plan}. */
export type QueryKind = keyof QueryDefinitions;

/** The endpoint parameters associated with a query kind. */
export type QueryParams<K extends QueryKind> = QueryDefinitions[K]["params"];

/** One decoded item associated with a query kind. */
export type QueryItem<K extends QueryKind> = QueryDefinitions[K]["item"];

/** The collected execution result associated with a query kind. */
export type QueryResult<K extends QueryKind> = QueryDefinitions[K]["result"];

/** A transport-independent request for one Velo query endpoint. */
export type QueryRequest<K extends QueryKind = QueryKind> = K extends QueryKind
  ? {
      readonly kind: K;
      readonly params: QueryParams<K>;
    }
  : never;

/** An immutable builder that produces one endpoint request. */
export interface QueryBuilder<K extends QueryKind = QueryKind> {
  build(): QueryRequest<K>;
}

/** An endpoint request or a builder that can produce one. */
export type QueryInput<K extends QueryKind = QueryKind> = QueryRequest<K> | QueryBuilder<K>;

type Planner<K extends QueryKind> = (
  params: QueryParams<K>,
) => QueryPlan<QueryItem<K>, QueryResult<K>>;

type PlannerRegistry = {
  readonly [K in QueryKind]: Planner<K>;
};

const PLANNERS: PlannerRegistry = Object.freeze({
  "orderbook.levels": planOrderbook,
});

/** Resolves a direct endpoint request or invokes a request builder. */
export function toQueryRequest<K extends QueryKind>(input: QueryInput<K>): QueryRequest<K> {
  const candidate: unknown = input;
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return input as QueryRequest<K>;
  }

  const { build } = candidate as { readonly build?: unknown };
  if (typeof build !== "function") return input as QueryRequest<K>;
  return build.call(candidate) as QueryRequest<K>;
}

/** Converts an endpoint request into the transport-ready plan for that endpoint. */
export function plan<K extends QueryKind>(
  request: QueryRequest<K>,
): QueryPlan<QueryItem<K>, QueryResult<K>> {
  const candidate: unknown = request;
  assert(
    typeof candidate === "object" && candidate !== null && !Array.isArray(candidate),
    "query request must be an object",
  );

  const { kind } = candidate as { readonly kind?: unknown };
  assert(typeof kind === "string", "query request kind must be a string");
  assert(Object.hasOwn(PLANNERS, kind), () => `Unknown query kind ${JSON.stringify(kind)}`);
  assert(Object.hasOwn(candidate, "params"), "query request must include params");

  /* Indexed access cannot preserve the correlation between a generic kind
   * and its mapped planner, so the registry boundary restores it here.
   */
  const planner = PLANNERS[kind as QueryKind] as unknown as Planner<K>;
  const { params } = candidate as { readonly params: QueryParams<K> };
  return planner(params);
}
