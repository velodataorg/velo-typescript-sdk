import type { Http } from "../../../transport/http.js";
import { CapsQuery } from "./query.js";

/** The market-caps namespace exposed by {@link Velo}. */
export class Caps {
  readonly query: CapsQuery["build"];

  constructor(http: Http) {
    const query = new CapsQuery(http);
    this.query = query.build.bind(query);
  }
}
