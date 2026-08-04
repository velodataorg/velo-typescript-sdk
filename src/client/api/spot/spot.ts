import { SpotBuilder } from "./builder.ts";

/** The spot `/rows` namespace exposed by {@link Velo}. */
export class Spot {
  readonly price: SpotBuilder<never>["price"];
  readonly volume: SpotBuilder<never>["volume"];
  readonly trades: SpotBuilder<never>["trades"];

  constructor() {
    const builder = new SpotBuilder();
    this.price = builder.price.bind(builder);
    this.volume = builder.volume.bind(builder);
    this.trades = builder.trades.bind(builder);
  }
}
