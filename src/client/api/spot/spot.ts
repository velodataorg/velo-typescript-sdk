import type { Http } from "../../../transport/http.js";
import { SpotQuery } from "./query.js";

/** The spot `/rows` namespace exposed by {@link Velo}. */
export class Spot {
  readonly query: SpotQuery["build"];

  constructor(http: Http) {
    const query = new SpotQuery(http);
    this.query = query.build.bind(query);
  }
}
