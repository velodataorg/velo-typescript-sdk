import type { Http } from "../../../../transport/http.js";
import { FuturesBuilder } from "./futures-builder.js";
import { FuturesQuery } from "./futures-query.js";

/** The futures `/rows` namespace exposed by {@link Velo}. */
export type Futures = Omit<FuturesBuilder<never>, "params" | "build" | "execute"> & {
  readonly query: FuturesQuery["build"];
};

export class FuturesNamespace extends FuturesBuilder<never> {
  readonly query: FuturesQuery["build"];

  constructor(http: Http) {
    const query = new FuturesQuery(http);
    super(query);
    this.query = query.build.bind(query);
  }
}
