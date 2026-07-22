import type { Http } from "../../../transport/http.js";
import type { Data } from "../../common/data/data.js";
import type { Row } from "../../common/data/row.js";
import {
  BASIS_COLUMN,
  type FuturesColumn,
  type FuturesStandardColumn,
} from "../../common/market/columns.js";
import { FUTURES_EXCHANGES, type FuturesExchange } from "../../common/market/exchanges.js";
import type { Query } from "../../common/query.js";
import { RowsQuery } from "../../common/rows/query.js";
import { FuturesParams, type FuturesBasisParams, type FuturesStandardParams } from "./params.js";

export type FuturesRow<C extends FuturesColumn> = Row<FuturesExchange, C>;

/** Creates validated lazy futures queries bound to an HTTP transport. */
export class FuturesQuery {
  readonly #http: Http;

  constructor(http: Http) {
    this.#http = http;
  }

  build(
    params: FuturesBasisParams,
  ): Query<FuturesRow<typeof BASIS_COLUMN>, Data<FuturesExchange, typeof BASIS_COLUMN>>;
  build<C extends FuturesStandardColumn>(
    params: FuturesStandardParams<C>,
  ): Query<FuturesRow<C>, Data<FuturesExchange, C>>;
  build(params: FuturesParams): Query<unknown, unknown> {
    return RowsQuery.create(this.#http, "futures", FuturesParams.parse(params), FUTURES_EXCHANGES);
  }
}
