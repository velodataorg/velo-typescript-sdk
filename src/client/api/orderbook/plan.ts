import { ORDERBOOK_PATH } from "../../../constants/endpoints.ts";
import { VeloError } from "../../../errors.ts";
import type { HttpParams } from "../../../transport/http.ts";
import type { QueryPlan } from "../../common/query.ts";
import { alignRange, clampEnd, type TimeRange } from "../../common/time/range.ts";
import { toResolutionValue } from "../../common/time/resolution.ts";
import { chunkBuckets } from "./chunk.ts";
import { OrderbookData, type OrderbookRow } from "./data.ts";
import { decodeOrderbook, decodeOrderbookLines } from "./decode.ts";
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
    decode(body): OrderbookRow[] {
      try {
        return decodeOrderbook(body);
      } catch (cause) {
        throw new VeloError(`Unexpected ${ORDERBOOK_PATH} response`, { cause });
      }
    },
    async *decodeLines(lines): AsyncIterable<OrderbookRow> {
      try {
        yield* decodeOrderbookLines(lines);
      } catch (cause) {
        throw new VeloError(`Unexpected ${ORDERBOOK_PATH} response`, { cause });
      }
    },
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
