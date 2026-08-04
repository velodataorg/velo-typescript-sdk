import type { QueryFactory } from "../../plan.ts";
import { SpotBuilder } from "./builder.ts";

/** The spot `/rows` namespace exposed by {@link Velo}. */
export class Spot {
  readonly price: SpotBuilder<never>["price"];
  readonly volume: SpotBuilder<never>["volume"];
  readonly trades: SpotBuilder<never>["trades"];

  constructor(query: QueryFactory<"spot.rows">) {
    const builder = new SpotBuilder(query);
    this.price = builder.price.bind(builder);
    this.volume = builder.volume.bind(builder);
    this.trades = builder.trades.bind(builder);
  }
}
