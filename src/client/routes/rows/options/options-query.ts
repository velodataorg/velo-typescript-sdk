import { OPTIONS_EXCHANGES, type OptionsExchange } from "../../../../exchange.js";
import type { Http } from "../../../../transport/http.js";
import type { Query } from "../../../query.js";
import type { OptionsColumn } from "../columns.js";
import type { Data } from "../data.js";
import { RowsQuery } from "../params.js";
import { OptionsParams, type OptionsRow } from "./params.js";

/** Creates validated lazy options queries bound to an HTTP transport. */
export class OptionsQuery {
  readonly #http: Http;

  constructor(http: Http) {
    this.#http = http;
  }

  /** Creates a lazy query from raw options parameters. */
  build<C extends OptionsColumn>(
    params: OptionsParams<C>,
  ): Query<OptionsRow<C>, Data<OptionsExchange, C>> {
    return RowsQuery.create(this.#http, "options", OptionsParams.parse(params), OPTIONS_EXCHANGES);
  }
}
