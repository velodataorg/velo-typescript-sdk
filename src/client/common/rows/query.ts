import { ROWS_PATH } from "../../../constants/endpoints.js";
import { VeloError } from "../../../errors.js";
import type { Http, HttpParams } from "../../../transport/http.js";
import { assert } from "../../../util/assert.js";
import { Data } from "../data/data.js";
import { Row } from "../data/row.js";
import { decode } from "../decode/csv.js";
import { Query } from "../query.js";
import { chunkRange } from "./chunk.js";
import type { MarketType, RowsQueryParams } from "./params.js";
import { alignRange, type TimeRange } from "./range.js";
import type { Resolution } from "./resolution.js";
import { toResolutionValue } from "./resolution.js";

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

/**
 * Caps a range end that alignment ceiled into the future at the current time.
 *
 * @remarks
 * Weekly and monthly alignment can ceil the end days into the future, and the
 * API rejects timestamps more than a day ahead. The response cannot contain
 * data past now anyway, so request the partial trailing bucket instead.
 *
 * @param range - The aligned time range.
 * @param requestedBegin - The begin requested before alignment, which may be
 * later than the floored `range.begin`.
 * @param now - The current millisecond timestamp.
 * @returns The range with its end capped at `now`.
 * @throws {@link VeloError} when capping is needed but the requested range
 * lies entirely in the future.
 */
function clampEnd(range: TimeRange, requestedBegin: number, now: number): TimeRange {
  if (range.end <= now) return range;
  assert(
    requestedBegin < now,
    `Invalid begin ${requestedBegin}: the requested range is entirely in the future`,
  );
  return { begin: range.begin, end: now };
}
