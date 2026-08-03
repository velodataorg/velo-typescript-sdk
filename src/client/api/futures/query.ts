import type { Http } from "../../../transport/http.ts";
import type { DataResult } from "../../common/data/data.ts";
import type { Row } from "../../common/data/row.ts";
import {
  BASIS_COLUMN,
  type FuturesColumn,
  type FuturesStandardColumn,
} from "../../common/market/columns.ts";
import { FUTURES_EXCHANGES, type FuturesExchange } from "../../common/market/exchanges.ts";
import type { Query } from "../../common/query.ts";
import { RowsQuery } from "../../common/rows/query.ts";
import { FuturesParams, type FuturesBasisParams, type FuturesStandardParams } from "./params.ts";

export type FuturesRow<C extends FuturesColumn, E extends FuturesExchange = FuturesExchange> = Row<
  E,
  C
>;

/** Creates validated lazy futures queries bound to an HTTP transport. */
export class FuturesQuery {
  readonly #http: Http;

  constructor(http: Http) {
    this.#http = http;
  }

  build(
    params: FuturesBasisParams,
  ): Query<FuturesRow<typeof BASIS_COLUMN>, DataResult<FuturesExchange, typeof BASIS_COLUMN>>;
  build<C extends FuturesStandardColumn, E extends FuturesExchange>(
    params: FuturesStandardParams<C, E>,
  ): Query<FuturesRow<C, E>, DataResult<E, C>>;
  build(params: FuturesParams): Query<unknown, unknown> {
    const parsed = FuturesParams.parse(params);
    /* Standard params validation guarantees a non-empty exchange selection;
       basis params omit exchanges and accept every futures response exchange. */
    const responseExchanges = (parsed.exchanges ?? FUTURES_EXCHANGES) as readonly [
      FuturesExchange,
      ...FuturesExchange[],
    ];
    return RowsQuery.create(this.#http, "futures", parsed, responseExchanges);
  }
}
