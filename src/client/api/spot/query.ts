import type { Http } from "../../../transport/http.ts";
import type { Data } from "../../common/data/data.ts";
import type { Row } from "../../common/data/row.ts";
import type { SpotColumn } from "../../common/market/columns.ts";
import { SPOT_EXCHANGES, type SpotExchange } from "../../common/market/exchanges.ts";
import type { Query } from "../../common/query.ts";
import { RowsQuery } from "../../common/rows/query.ts";
import { SpotParams } from "./params.ts";

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
