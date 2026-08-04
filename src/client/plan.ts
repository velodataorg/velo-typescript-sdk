import { assert } from "../util/assert.ts";
import type {
  FuturesBasisParams,
  FuturesRow,
  FuturesStandardParams,
} from "./api/futures/params.ts";
import { planFuturesBasis, planFuturesRows } from "./api/futures/plan.ts";
import type { NewsStoriesParams } from "./api/news/params.ts";
import { planNewsStories } from "./api/news/plan.ts";
import type { NewsStory } from "./api/news/validation.ts";
import type { OptionsParams, OptionsRow } from "./api/options/params.ts";
import { planOptionsRows, planOptionsTerms } from "./api/options/plan.ts";
import type { TermPoint, TermsParams } from "./api/options/terms.ts";
import type { OrderbookData, OrderbookRow } from "./api/orderbook/data.ts";
import type { OrderbookParams } from "./api/orderbook/params.ts";
import { planOrderbook } from "./api/orderbook/plan.ts";
import type { SpotParams, SpotRow } from "./api/spot/params.ts";
import { planSpotRows } from "./api/spot/plan.ts";
import type { DataResult } from "./common/data/data.ts";
import type { Row } from "./common/data/row.ts";
import type { FuturesStandardColumn, OptionsColumn, SpotColumn } from "./common/market/columns.ts";
import { BASIS_COLUMN } from "./common/market/columns.ts";
import type { FuturesExchange, OptionsExchange, SpotExchange } from "./common/market/exchanges.ts";
import type { QueryPlan } from "./common/query.ts";

/** Endpoint contracts understood by the central query planner. */
export interface QueryDefinitions {
  "futures.basis": {
    params: FuturesBasisParams;
    item: FuturesRow<typeof BASIS_COLUMN>;
    result: DataResult<FuturesExchange, typeof BASIS_COLUMN>;
  };
  "futures.rows": {
    params: FuturesStandardParams;
    item: FuturesRow<FuturesStandardColumn>;
    result: DataResult<FuturesExchange, FuturesStandardColumn>;
  };
  "news.stories": {
    params: NewsStoriesParams;
    item: NewsStory;
    result: NewsStory[];
  };
  "options.rows": {
    params: OptionsParams;
    item: OptionsRow<OptionsColumn>;
    result: DataResult<OptionsExchange, OptionsColumn>;
  };
  "options.terms": {
    params: TermsParams;
    item: TermPoint;
    result: TermPoint[];
  };
  "orderbook.levels": {
    params: OrderbookParams;
    item: OrderbookRow;
    result: OrderbookData;
  };
  "spot.rows": {
    params: SpotParams;
    item: SpotRow<SpotColumn>;
    result: DataResult<SpotExchange, SpotColumn>;
  };
}

/** A query endpoint handled by {@link plan}. */
export type QueryKind = keyof QueryDefinitions;

/** The endpoint parameters associated with a query kind. */
export type QueryParams<K extends QueryKind> = QueryDefinitions[K]["params"];

/** One decoded item associated with a query kind. */
type RowsItem<P> = P extends {
  readonly exchanges: readonly (infer E extends string)[];
  readonly columns: readonly (infer C extends string)[];
}
  ? Row<E, C>
  : never;

type RowsResult<P> = P extends {
  readonly exchanges: readonly (infer E extends string)[];
  readonly columns: readonly (infer C extends string)[];
}
  ? DataResult<E, C>
  : never;

export type QueryItem<
  K extends QueryKind,
  P extends QueryParams<K> = QueryParams<K>,
> = K extends `${string}.rows` ? RowsItem<P> : QueryDefinitions[K]["item"];

/** The collected execution result associated with a query kind. */
export type QueryResult<
  K extends QueryKind,
  P extends QueryParams<K> = QueryParams<K>,
> = K extends `${string}.rows` ? RowsResult<P> : QueryDefinitions[K]["result"];

/** A transport-independent request for one Velo query endpoint. */
export type QueryRequest<
  K extends QueryKind = QueryKind,
  P extends QueryParams<K> = QueryParams<K>,
> = K extends QueryKind
  ? {
      readonly kind: K;
      readonly params: P;
    }
  : never;

/** An immutable builder that produces one endpoint request. */
export interface QueryBuilder<
  K extends QueryKind = QueryKind,
  P extends QueryParams<K> = QueryParams<K>,
> {
  build(): QueryRequest<K, P>;
}

/** An endpoint request or a builder that can produce one. */
export type QueryInput<
  K extends QueryKind = QueryKind,
  P extends QueryParams<K> = QueryParams<K>,
> = QueryRequest<K, P> | QueryBuilder<K, P>;

type Planner<K extends QueryKind> = (
  params: QueryParams<K>,
) => QueryPlan<QueryItem<K>, QueryResult<K>>;

type PlannerRegistry = {
  readonly [K in QueryKind]: Planner<K>;
};

const PLANNERS: PlannerRegistry = Object.freeze({
  "futures.basis": planFuturesBasis,
  "futures.rows": planFuturesRows,
  "news.stories": planNewsStories,
  "options.rows": planOptionsRows,
  "options.terms": planOptionsTerms,
  "orderbook.levels": planOrderbook,
  "spot.rows": planSpotRows,
});

/** Resolves a direct endpoint request or invokes a request builder. */
export function toQueryRequest<K extends QueryKind, P extends QueryParams<K>>(
  input: QueryInput<K, P>,
): QueryRequest<K, P> {
  const candidate: unknown = input;
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return input as QueryRequest<K, P>;
  }

  const { build } = candidate as { readonly build?: unknown };
  if (typeof build !== "function") return input as QueryRequest<K, P>;
  return build.call(candidate) as QueryRequest<K, P>;
}

/** Converts an endpoint request into the transport-ready plan for that endpoint. */
export function plan<K extends QueryKind, P extends QueryParams<K>>(
  request: QueryRequest<K, P>,
): QueryPlan<QueryItem<K, P>, QueryResult<K, P>> {
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
  const planner = PLANNERS[kind as QueryKind] as unknown as (
    params: P,
  ) => QueryPlan<QueryItem<K, P>, QueryResult<K, P>>;
  const { params } = candidate as { readonly params: P };
  return planner(params);
}
