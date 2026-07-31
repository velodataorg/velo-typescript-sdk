import { ORDERBOOK_PATH } from "../../../constants/endpoints.js";
import { VeloError } from "../../../errors.js";
import type { Http, HttpParams } from "../../../transport/http.js";
import { Query } from "../../common/query.js";
import { alignRange, clampEnd, type TimeRange } from "../../common/time/range.js";
import { toResolutionValue } from "../../common/time/resolution.js";
import { chunkBuckets } from "./chunk.js";
import { OrderbookData, type OrderbookRow } from "./data.js";
import { decodeOrderbook } from "./decode.js";
import { OrderbookParams } from "./params.js";

/** Creates validated lazy orderbook queries bound to an HTTP transport. */
export class OrderbookQuery {
  readonly #http: Http;

  constructor(http: Http) {
    this.#http = http;
  }

  /** Creates a lazy query from raw orderbook parameters. */
  build(params: OrderbookParams): Query<OrderbookRow, OrderbookData> {
    const parsed = OrderbookParams.parse(params);
    const minutes = toResolutionValue(parsed.resolution).count;
    const aligned = alignRange({ begin: parsed.begin, end: parsed.end }, parsed.resolution);
    const range = clampEnd(aligned, parsed.begin, Date.now());
    const requests = chunkBuckets(range, minutes).map((chunk) => ({
      path: ORDERBOOK_PATH,
      params: toHttpParams(parsed, minutes, chunk),
    }));

    return new Query(this.#http, {
      requests,
      decode(body): OrderbookRow[] {
        try {
          return decodeOrderbook(body);
        } catch (cause) {
          throw new VeloError(`Unexpected ${ORDERBOOK_PATH} response`, { cause });
        }
      },
      collect: (rows) => new OrderbookData(rows),
    });
  }
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
