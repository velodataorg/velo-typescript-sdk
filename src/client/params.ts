import type { CapsParams } from "./caps/caps.js";
import type { MarketType } from "./rows/markets.js";
import type { RowsParams } from "./rows/params.js";
import type { TermsParams } from "./terms/terms.js";

/* Everything a query can ask for: one kind per rows market, plus caps and
 * terms — matching how the client is reached (`velo.futures.query()`,
 * `velo.caps()`, `velo.options.terms()`).
 */
export type QueryKind = MarketType | "caps" | "terms";

/**
 * The developer-facing description of a query, by kind.
 *
 * @remarks
 * Every query starts as a `QueryParams`: the client validates it and lowers
 * it to wire requests, and returns a `Query` handle to execute or stream.
 * Nothing inside the SDK consumes this union — each endpoint takes its
 * concrete params type — but it names the layer for user code generic over
 * queries.
 *
 * @typeParam K - The query kind; defaults to the union of every kind.
 */
export type QueryParams<K extends QueryKind = QueryKind> = {
  futures: RowsParams<"futures">;
  options: RowsParams<"options">;
  spot: RowsParams<"spot">;
  caps: CapsParams;
  terms: TermsParams;
}[K];
