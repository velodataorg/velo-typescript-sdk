import type { Http } from "../../../transport/http.js";
import type { Data } from "../../common/data/data.js";
import type { OptionsColumn } from "../../common/market/columns.js";
import { OPTIONS_EXCHANGES, type OptionsExchange } from "../../common/market/exchanges.js";
import type { Query } from "../../common/query.js";
import { RowsQuery } from "../../common/rows/query.js";
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
