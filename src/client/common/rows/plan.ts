import { ROWS_PATH } from "../../../constants/endpoints.ts";
import { VeloError } from "../../../errors.ts";
import type { HttpParams } from "../../../transport/http.ts";
import { Data, type DataResult } from "../data/data.ts";
import { Row } from "../data/row.ts";
import { decode } from "../decode/csv.ts";
import type { QueryPlan } from "../query.ts";
import { alignRange, clampEnd, type TimeRange } from "../time/range.ts";
import type { Resolution } from "../time/resolution.ts";
import { toResolutionValue } from "../time/resolution.ts";
import { chunkRange } from "./chunk.ts";
import type { MarketType, RowsQueryParams } from "./params.ts";

/** Plans a market rows query from already validated market-specific parameters. */
export function planRows<E extends string, C extends string>(
  type: MarketType,
  params: RowsQueryParams<C>,
  responseExchanges: readonly [E, ...E[]],
): QueryPlan<Row<E, C>, DataResult<E, C>> {
  const aligned = alignRange({ begin: params.begin, end: params.end }, params.resolution);
  const range = clampEnd(aligned, params.begin, Date.now());
  const requests = chunkRange(params, range).map((chunk) => ({
    path: ROWS_PATH,
    params: toHttpParams(type, params, chunk),
  }));
  const schema = Row.schema(responseExchanges, params.columns);

  return {
    requests,
    decode(body): Row<E, C>[] {
      try {
        return decode(body, schema) as Row<E, C>[];
      } catch (cause) {
        throw new VeloError(`Unexpected ${ROWS_PATH} response`, { cause });
      }
    },
    collect: (rows): DataResult<E, C> => new Data<E, C>(rows),
  };
}

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
