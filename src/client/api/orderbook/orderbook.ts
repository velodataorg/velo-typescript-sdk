import type { QueryFactory } from "../../plan.ts";
import { OrderbookLevelsBuilder } from "./builder.ts";
import type { OrderbookScope } from "./scope.ts";

/** The orderbook depth namespace exposed by {@link Velo}. */
export class Orderbook {
  readonly #query: QueryFactory<"orderbook.levels">;

  constructor(query: QueryFactory<"orderbook.levels">) {
    this.#query = query;
  }

  /**
   * Creates an immutable orderbook-levels builder bound to this client.
   *
   * A trailing duration in the scope is fixed when this method is called.
   */
  levels(scope: OrderbookScope): OrderbookLevelsBuilder {
    return new OrderbookLevelsBuilder(scope, this.#query);
  }
}
