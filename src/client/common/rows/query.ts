import type { Http } from "../../../transport/http.ts";
import type { DataResult } from "../data/data.ts";
import type { Row } from "../data/row.ts";
import { Query } from "../query.ts";
import type { MarketType, RowsQueryParams } from "./params.ts";
import { planRows } from "./plan.ts";

export const RowsQuery = Object.freeze({
  /** Creates a lazy query from already validated market-specific parameters. */
  create<E extends string, C extends string>(
    http: Http,
    type: MarketType,
    params: RowsQueryParams<C>,
    responseExchanges: readonly [E, ...E[]],
  ): Query<Row<E, C>, DataResult<E, C>> {
    return new Query(http, planRows(type, params, responseExchanges));
  },
});
