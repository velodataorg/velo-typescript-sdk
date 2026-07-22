import { SPOT_EXCHANGES, type SpotExchange } from "../../../../exchange.js";
import type { Http } from "../../../../transport/http.js";
import type { Query } from "../../../query.js";
import type { SpotColumn } from "../columns.js";
import type { Data, Row } from "../data.js";
import { RowsQuery } from "../params.js";
import { SpotParams } from "./params.js";

export type SpotRow<C extends SpotColumn> = Row<SpotExchange, C>;

/** Creates validated lazy spot queries bound to an HTTP transport. */
export class SpotQuery {
  readonly #http: Http;

  constructor(http: Http) {
    this.#http = http;
  }

  /** Creates a lazy query from raw spot parameters. */
  build<C extends SpotColumn>(params: SpotParams<C>): Query<SpotRow<C>, Data<SpotExchange, C>> {
    return RowsQuery.create(this.#http, "spot", SpotParams.parse(params), SPOT_EXCHANGES);
  }
}
