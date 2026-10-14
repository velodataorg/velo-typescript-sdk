import { ORDERBOOK_PATH } from "../../../constants/endpoints.ts";
import type { HttpParams } from "../../../transport/http.ts";
import { decodeLines } from "../../decode/lines.ts";
import type { QueryPlan } from "../../query/query.ts";
import { alignRange, clampEnd, type TimeRange } from "../../time/range.ts";
import { toResolutionValue } from "../../time/resolution.ts";
import { chunkBuckets } from "./chunk.ts";
import { OrderbookData, type OrderbookRow } from "./data.ts";
import { orderbookRows } from "./decode.ts";
import { OrderbookParams } from "./params.ts";

/** Plans an orderbook query from raw endpoint parameters. */
export function planOrderbook(params: OrderbookParams): QueryPlan<OrderbookRow, OrderbookData> {
  const parsed = OrderbookParams.parse(params);
  const minutes = toResolutionValue(parsed.resolution).count;
  const aligned = alignRange({ begin: parsed.begin, end: parsed.end }, parsed.resolution);
  const range = clampEnd(aligned, parsed.begin, Date.now());
  const requests = chunkBuckets(range, minutes).map((chunk) => ({
    path: ORDERBOOK_PATH,
    params: toHttpParams(parsed, minutes, chunk),
  }));

  return {
    requests,
    decodeLines: (lines) => decodeLines(lines, orderbookRows(), ORDERBOOK_PATH),
    collect: (rows) => new OrderbookData(rows),
  };
}

/**
 * Serializes one chunk into the levels endpoint's wire parameters.
 *
 * @param params - The validated orderbook parameters.
 * @param minutes - The bucket size the resolution lowered to.
 * @param range - The chunk's half-open time range.
 */
function toHttpParams(params: OrderbookParams, minutes: number, range: TimeRange): HttpParams {
  return {
    exchange: params.exchange,
    product: params.product,
    coin: params.coin,
    begin: range.begin,
    end: range.end,
    reso: minutes,
    /* Orders buckets time-ascending; the server returns them descending
     * otherwise.
     */
    forward: 1,
  };
}
