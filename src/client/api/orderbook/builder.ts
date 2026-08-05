import type { QueryBuilder, QueryRequest } from "../../query/plan.ts";
import { toOrderbookParams, type OrderbookScope } from "./scope.ts";

/** An immutable orderbook-levels request builder. */
export class OrderbookLevelsBuilder implements QueryBuilder<"orderbook.levels"> {
  readonly #request: QueryRequest<"orderbook.levels">;

  constructor(scope: OrderbookScope) {
    const params = Object.freeze(toOrderbookParams(scope));
    this.#request = Object.freeze({ kind: "orderbook.levels", params });
  }

  /** Returns the immutable transport-independent endpoint request. */
  build(): QueryRequest<"orderbook.levels"> {
    return this.#request;
  }
}
