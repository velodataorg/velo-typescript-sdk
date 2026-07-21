import { z } from "zod";

import { ROWS_PATH } from "../../../constants.js";
import { VeloError } from "../../../errors.js";
import { timestamp, uniqueArray } from "../../../schema.js";
import type { Http, HttpParams } from "../../../transport/http.js";
import { decode } from "../../decode/decode.js";
import { Query } from "../../query.js";
import { Data, Row } from "./data.js";
import { alignRange } from "./util/align.js";
import type { TimeRange } from "./util/align.js";
import { chunkRange } from "./util/chunk.js";
import type { Resolution } from "./util/resolution.js";
import { ResolutionSchema, toResolutionValue } from "./util/resolution.js";

export type MarketType = "futures" | "options" | "spot";

/*//////////////////////////////////////////////////////////////
                            ROW PARAMS
//////////////////////////////////////////////////////////////*/

interface RowsParamsBase<E extends string, C extends string> {
  readonly exchanges: readonly E[];
  readonly columns: readonly C[];
  readonly begin: number;
  readonly end: number;
  readonly resolution: Resolution;
}

export interface RowsParamsProducts<E extends string, C extends string> extends RowsParamsBase<
  E,
  C
> {
  readonly products: readonly string[];
  readonly coins?: never;
}

export interface RowsParamsCoins<E extends string, C extends string> extends RowsParamsBase<E, C> {
  readonly coins: readonly string[];
  readonly products?: never;
}

export type RowsParams<E extends string, C extends string> =
  | RowsParamsProducts<E, C>
  | RowsParamsCoins<E, C>;

const NonEmptyStringArraySchema = uniqueArray(z.string().min(1));

export const RowsParams = Object.freeze({
  /** Creates the strict parameter schema shared by ordinary market queries. */
  schema<E extends readonly [string, ...string[]], C extends readonly [string, ...string[]]>(
    exchanges: E,
    columns: C,
  ) {
    const common = {
      exchanges: uniqueArray(z.enum(exchanges)),
      columns: uniqueArray(z.enum(columns)),
      begin: timestamp,
      end: timestamp,
      resolution: ResolutionSchema,
    };

    return z
      .union([
        z.strictObject({
          ...common,
          products: NonEmptyStringArraySchema,
        }),
        z.strictObject({
          ...common,
          coins: NonEmptyStringArraySchema,
        }),
      ])
      .refine((params) => params.end > params.begin, {
        path: ["end"],
        message: "must be a millisecond timestamp after begin",
      });
  },
});

/*//////////////////////////////////////////////////////////////
                            ROW QUERY
//////////////////////////////////////////////////////////////*/

export interface RowsQueryParams<C extends string = string> {
  readonly exchanges?: readonly string[];
  readonly columns: readonly C[];
  readonly products?: readonly string[];
  readonly coins?: readonly string[];
  readonly begin: number;
  readonly end: number;
  readonly resolution: Resolution;
}

export const RowsQuery = Object.freeze({
  /** Creates a lazy query from already validated market-specific parameters. */
  create<E extends string, C extends string>(
    http: Http,
    type: MarketType,
    params: RowsQueryParams<C>,
    responseExchanges: readonly [E, ...E[]],
  ): Query<Row<E, C>, Data<E, C>> {
    const range = alignRange({ begin: params.begin, end: params.end }, params.resolution);
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
