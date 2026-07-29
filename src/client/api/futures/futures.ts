import type { Http } from "../../../transport/http.js";
import { FuturesBasisBuilder } from "./basis.js";
import { FuturesBuilder } from "./builder.js";
import { FuturesQuery } from "./query.js";

/** The futures `/rows` namespace exposed by {@link Velo}. */
export class Futures {
  readonly query: FuturesQuery["build"];
  readonly basis: () => FuturesBasisBuilder;
  readonly price: FuturesBuilder<never>["price"];
  readonly volume: FuturesBuilder<never>["volume"];
  readonly trades: FuturesBuilder<never>["trades"];
  readonly openInterest: FuturesBuilder<never>["openInterest"];
  readonly fundingRate: FuturesBuilder<never>["fundingRate"];
  readonly premium: FuturesBuilder<never>["premium"];
  readonly liquidations: FuturesBuilder<never>["liquidations"];
  readonly liquidationVolume: FuturesBuilder<never>["liquidationVolume"];
  readonly exchanges: FuturesBuilder<never>["exchanges"];

  constructor(http: Http) {
    const query = new FuturesQuery(http);
    const builder = new FuturesBuilder(query);
    this.query = query.build.bind(query);
    this.basis = () => new FuturesBasisBuilder(query);
    this.price = builder.price.bind(builder);
    this.volume = builder.volume.bind(builder);
    this.trades = builder.trades.bind(builder);
    this.openInterest = builder.openInterest.bind(builder);
    this.fundingRate = builder.fundingRate.bind(builder);
    this.premium = builder.premium.bind(builder);
    this.liquidations = builder.liquidations.bind(builder);
    this.liquidationVolume = builder.liquidationVolume.bind(builder);
    this.exchanges = builder.exchanges.bind(builder);
  }
}
