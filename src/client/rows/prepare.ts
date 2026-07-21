import { ROWS_PATH } from "../../constants.js";
import { decode } from "../../decode/decode.js";
import { VeloError } from "../../errors.js";
import type { Http, HttpParams } from "../../transport/http.js";
import { Query } from "../query.js";
import { Data } from "./data.js";
import type { ValidatedRowsParams } from "./params.js";
import { createRowSchema } from "./schema.js";
import type { MarketType } from "./types.js";
import type { Row } from "./types.js";
import { alignRange } from "./util/align.js";
import type { TimeRange } from "./util/align.js";
import { chunkRange } from "./util/chunk.js";
import type { Resolution } from "./util/resolution.js";
import { toResolutionValue } from "./util/resolution.js";

/**
 * Creates a lazy query from already validated market-specific parameters.
 */
export function createRowsQuery<E extends string, C extends string>(
  http: Http,
  type: MarketType,
  params: ValidatedRowsParams & { readonly columns: readonly C[] },
  responseExchanges: readonly [E, ...E[]],
): Query<Row<E, C>, Data<E, C>> {
  const range = alignRange({ begin: params.begin, end: params.end }, params.resolution);
  const requests = chunkRange(params, range).map((chunk) => ({
    path: ROWS_PATH,
    params: toHttpParams(type, params, chunk),
  }));
  const schema = createRowSchema(responseExchanges, params.columns);

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
}

function toHttpParams(type: MarketType, params: ValidatedRowsParams, range: TimeRange): HttpParams {
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
