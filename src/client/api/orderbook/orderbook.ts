import type { Http, HttpRequestOptions } from "../../../transport/http.ts";
import type { Query } from "../../common/query.ts";
import type { OrderbookData, OrderbookRow } from "./data.ts";
import { OrderbookQuery } from "./query.ts";
import { lowerOrderbookScope, type OrderbookScope } from "./scope.ts";

/** The orderbook depth namespace exposed by {@link Velo}. */
export class Orderbook {
  /**
   * Lowers the scope into a lazy query without sending a request.
   *
   * A trailing duration in the scope is fixed when this method is called.
   */
  readonly query: (scope: OrderbookScope) => Query<OrderbookRow, OrderbookData>;

  /**
   * Lowers and immediately executes the scope.
   */
  readonly execute: (scope: OrderbookScope, options?: HttpRequestOptions) => Promise<OrderbookData>;

  constructor(http: Http) {
    const query = new OrderbookQuery(http);
    this.query = (scope) => query.build(lowerOrderbookScope(scope));
    this.execute = (scope, options) => this.query(scope).execute(options);
  }
}
