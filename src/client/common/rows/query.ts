import { ROWS_PATH } from "../../../constants/endpoints.ts";
import { VeloError } from "../../../errors.ts";
import type { Http, HttpParams } from "../../../transport/http.ts";
import { Data } from "../data/data.ts";
import { Row } from "../data/row.ts";
import { decode } from "../decode/csv.ts";
import { Query } from "../query.ts";
import { alignRange, clampEnd, type TimeRange } from "../time/range.ts";
import type { Resolution } from "../time/resolution.ts";
import { toResolutionValue } from "../time/resolution.ts";
import { chunkRange } from "./chunk.ts";
import type { MarketType, RowsQueryParams } from "./params.ts";

export const RowsQuery = Object.freeze({
  /** Creates a lazy query from already validated market-specific parameters. */
  create<E extends string, C extends string>(
    http: Http,
    type: MarketType,
    params: RowsQueryParams<C>,
    responseExchanges: readonly [E, ...E[]],
  ): Query<Row<E, C>, Data<E, C>> {
    const aligned = alignRange({ begin: params.begin, end: params.end }, params.resolution);
    const range = clampEnd(aligned, params.begin, Date.now());
    const requests = chunkRange(params, range).map((chunk) => ({
      path: ROWS_PATH,
      params: toHttpParams(type, params, chunk),
    }));
    const schema = Row.schema(responseExchanges, params.columns);

    return new Query(http, {
      requests,
      decode(body): Row<E, C>[] {
        try {
          return decode(body, schema) as Row<E, C>[];
        } catch (cause) {
          throw new VeloError(`Unexpected ${ROWS_PATH} response`, { cause });
        }
      },
      collect: (rows) => new Data(rows),
    });
  },
});

function toHttpParams(type: MarketType, params: RowsQueryParams, range: TimeRange): HttpParams {
  return {
    type,
    exchanges: params.exchanges,
    coins: params.coins,
    products: params.products,
    columns: params.columns,
    begin: range.begin,
    end: range.end,
    ...toResolutionParams(params.resolution),
  };
}

function toResolutionParams(resolution: Resolution): { resolution: number; months?: boolean } {
  const value = toResolutionValue(resolution);
  return value.unit === "months"
    ? { resolution: value.count, months: true }
    : { resolution: value.count };
}
