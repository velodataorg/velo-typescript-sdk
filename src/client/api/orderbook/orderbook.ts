import { OrderbookLevelsBuilder } from "./builder.ts";
import type { OrderbookScope } from "./scope.ts";

/** The orderbook depth namespace exposed by {@link Velo}. */
export class Orderbook {
  /**
   * Creates an immutable orderbook-levels request builder.
   *
   * A trailing duration in the scope is fixed when this method is called.
   */
  levels(scope: OrderbookScope): OrderbookLevelsBuilder {
    return new OrderbookLevelsBuilder(scope);
  }
}
