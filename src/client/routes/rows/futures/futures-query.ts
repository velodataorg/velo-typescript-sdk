import { FUTURES_EXCHANGES, type FuturesExchange } from "../../../../exchange.js";
import type { Http } from "../../../../transport/http.js";
import type { Query } from "../../../query.js";
import { BASIS_COLUMN, type FuturesStandardColumn } from "../columns.js";
import type { Data } from "../data.js";
import { RowsQuery } from "../params.js";
import {
  FuturesParams,
  type FuturesBasisParams,
  type FuturesRow,
  type FuturesStandardParams,
} from "./params.js";

/** Creates validated lazy futures queries bound to an HTTP transport. */
export class FuturesQuery {
  readonly #http: Http;

  constructor(http: Http) {
    this.#http = http;
  }

  /** Creates a lazy query from raw basis parameters. */
  build(
    params: FuturesBasisParams,
  ): Query<FuturesRow<typeof BASIS_COLUMN>, Data<FuturesExchange, typeof BASIS_COLUMN>>;

  /** Creates a lazy query from raw standard futures parameters. */
  build<C extends FuturesStandardColumn>(
    params: FuturesStandardParams<C>,
  ): Query<FuturesRow<C>, Data<FuturesExchange, C>>;
  build(params: FuturesParams): Query<unknown, unknown> {
    return RowsQuery.create(this.#http, "futures", FuturesParams.parse(params), FUTURES_EXCHANGES);
  }
}
