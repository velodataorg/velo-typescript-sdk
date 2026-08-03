import type { Http } from "../../../transport/http.ts";
import { MarketCapsQuery } from "./query.ts";

/** The market-caps namespace exposed by {@link Velo}. */
export class MarketCaps {
  readonly query: MarketCapsQuery["build"];

  constructor(http: Http) {
    const query = new MarketCapsQuery(http);
    this.query = query.build.bind(query);
  }
}
