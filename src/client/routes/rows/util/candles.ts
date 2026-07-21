import { z } from "zod";

import { VeloError } from "../../../../errors.js";
import { assert } from "../../../../util/assert.js";
import type { RowBase } from "../data.js";

export type OhlcColumn = "open_price" | "high_price" | "low_price" | "close_price";
export type VolumeColumn = "coin_volume" | "dollar_volume";

/**
 * One OHLC bucket of a single series.
 *
 * `volume` is present on every candle when the query requested a volume
 * column.
 */
export interface Candle {
  readonly time: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume?: number;
}

/**
 * Whether candles can be built from the requested columns: all four OHLC
 * columns plus at most one volume column, and nothing else.
 *
 * @typeParam C - Columns requested by the query.
 */
export type CanCandle<C extends string> = OhlcColumn extends C
  ? [C] extends [OhlcColumn | "coin_volume"]
    ? true
    : [C] extends [OhlcColumn | "dollar_volume"]
      ? true
      : false
  : false;

/**
 * The `this` type `candles()` requires when the requested columns cannot
 * form candles. Its name and property surface the rule in the resulting
 * compile error.
 */
export interface CandlesUnavailable {
  readonly "candles() requires all four OHLC columns and at most one volume column": never;
}

/**
 * The fields candle conversion reads: the base fields plus whichever OHLCV
 * columns the query requested.
 */
export type CandleRow = RowBase & Partial<Record<OhlcColumn | VolumeColumn, number | null>>;

/**
 * Converts one series' rows into candles.
 *
 * Buckets whose four OHLC values are all null (no trades) are skipped. The
 * runtime column checks mirror {@link CanCandle}, which callers can defeat
 * with a cast.
 *
 * @param rows - One series' rows in time-ascending order.
 * @returns One candle per non-empty bucket.
 */
export function toCandles(rows: readonly CandleRow[]): readonly Candle[] {
  const first = rows[0];
  if (first === undefined) return [];

  const candles: Candle[] = [];
  const firstCandle = parseCandle(first);
  if (firstCandle !== undefined) candles.push(firstCandle);

  for (let index = 1; index < rows.length; index++) {
    const candle = mapCandle(rows[index]!);
    if (candle !== undefined) candles.push(candle);
  }
  return candles;
}

const NullableNumberSchema = z.number().nullable();

/* The runtime mirror of CanCandle: the base fields plus all four OHLC
   columns, at most one volume column, and nothing else. */
const CandleRowSchema = z
  .strictObject({
    exchange: z.string(),
    coin: z.string(),
    product: z.string(),
    time: z.number(),
    open_price: NullableNumberSchema,
    high_price: NullableNumberSchema,
    low_price: NullableNumberSchema,
    close_price: NullableNumberSchema,
    coin_volume: NullableNumberSchema.optional(),
    dollar_volume: NullableNumberSchema.optional(),
  })
  .refine((row) => row.coin_volume === undefined || row.dollar_volume === undefined, {
    message: "coin_volume and dollar_volume are mutually exclusive",
  });

/**
 * Parses one row into a candle after validating that its columns can form
 * candles.
 *
 * @throws A `VeloError` unless the columns are the four OHLC columns plus at
 * most one volume column.
 */
function parseCandle(row: CandleRow): Candle | undefined {
  const parsed = CandleRowSchema.safeParse(row);
  if (!parsed.success) {
    throw new VeloError(
      "candles() requires all four OHLC columns and at most one volume column:\n" +
        z.prettifyError(parsed.error),
    );
  }
  return mapCandle(row);
}

/**
 * Maps one row to a candle, skipping empty buckets.
 */
function mapCandle(row: CandleRow): Candle | undefined {
  const { time, open_price: open, high_price: high, low_price: low, close_price: close } = row;

  if (open === null && high === null && low === null && close === null) return undefined;

  assert(
    open !== null && open !== undefined,
    () => `Bucket at time ${time}: open_price is null in a non-empty bucket`,
  );
  assert(
    high !== null && high !== undefined,
    () => `Bucket at time ${time}: high_price is null in a non-empty bucket`,
  );
  assert(
    low !== null && low !== undefined,
    () => `Bucket at time ${time}: low_price is null in a non-empty bucket`,
  );
  assert(
    close !== null && close !== undefined,
    () => `Bucket at time ${time}: close_price is null in a non-empty bucket`,
  );

  const candle: Candle = { time, open, high, low, close };

  if (row.coin_volume !== undefined) {
    assert(
      row.coin_volume !== null,
      () => `Bucket at time ${time}: coin_volume is null in a non-empty bucket`,
    );
    return { ...candle, volume: row.coin_volume };
  }

  if (row.dollar_volume !== undefined) {
    assert(
      row.dollar_volume !== null,
      () => `Bucket at time ${time}: dollar_volume is null in a non-empty bucket`,
    );
    return { ...candle, volume: row.dollar_volume };
  }

  return candle;
}
