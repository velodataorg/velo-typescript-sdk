import type { Http } from "../../../transport/http.js";
import { SpotBuilder } from "./builder.js";
import { SpotQuery } from "./query.js";

/** The spot `/rows` namespace exposed by {@link Velo}. */
export class Spot {
  readonly query: SpotQuery["build"];
  readonly price: SpotBuilder<never>["price"];
  readonly volume: SpotBuilder<never>["volume"];
  readonly trades: SpotBuilder<never>["trades"];
  readonly exchanges: SpotBuilder<never>["exchanges"];

  constructor(http: Http) {
    const query = new SpotQuery(http);
    const builder = new SpotBuilder(query);
    this.query = query.build.bind(query);
    this.price = builder.price.bind(builder);
    this.volume = builder.volume.bind(builder);
    this.trades = builder.trades.bind(builder);
    this.exchanges = builder.exchanges.bind(builder);
  }
}
