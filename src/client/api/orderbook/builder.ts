import type { HttpRequestOptions } from "../../../transport/http.ts";
import type { QueryBuilder, QueryFactory, QueryRequest } from "../../plan.ts";
import type { OrderbookData, OrderbookRow } from "./data.ts";
import { toOrderbookParams, type OrderbookScope } from "./scope.ts";

/** An immutable orderbook-levels request builder bound to one client. */
export class OrderbookLevelsBuilder implements QueryBuilder<"orderbook.levels"> {
  readonly #request: QueryRequest<"orderbook.levels">;
  readonly #query: QueryFactory<"orderbook.levels">;

  constructor(scope: OrderbookScope, query: QueryFactory<"orderbook.levels">) {
    const params = Object.freeze(toOrderbookParams(scope));
    this.#request = Object.freeze({ kind: "orderbook.levels", params });
    this.#query = query;
  }

  /** Returns the immutable transport-independent endpoint request. */
  build(): QueryRequest<"orderbook.levels"> {
    return this.#request;
  }

  /** Creates and immediately executes a lazy query through the bound client. */
  fetch(options?: HttpRequestOptions): Promise<OrderbookData> {
    return this.#query(this.#request).execute(options);
  }

  /** Creates a lazy query and streams its decoded rows through the bound client. */
  stream(options?: HttpRequestOptions): AsyncIterable<OrderbookRow> {
    return this.#query(this.#request).stream(options);
  }
}
