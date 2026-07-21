import { assert } from "../../util/assert.js";
import { ROWS_BASE_COLUMNS } from "./schema.js";
import type { RowBase } from "./types.js";

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

  const volumeColumn = assertCandleColumns(first);
  const candles: Candle[] = [];
  for (const row of rows) {
    if (OHLC_COLUMNS.every((column) => row[column] === null)) continue;

    const candle: Candle = {
      time: row.time,
      open: columnValue(row, "open_price"),
      high: columnValue(row, "high_price"),
      low: columnValue(row, "low_price"),
      close: columnValue(row, "close_price"),
    };
    candles.push(
      volumeColumn === undefined ? candle : { ...candle, volume: columnValue(row, volumeColumn) },
    );
  }
  return candles;
}

const OHLC_COLUMNS: readonly OhlcColumn[] = [
  "open_price",
  "high_price",
  "low_price",
  "close_price",
];
const OHLC_SET: ReadonlySet<string> = new Set(OHLC_COLUMNS);
const VOLUME_SET: ReadonlySet<string> = new Set(["coin_volume", "dollar_volume"]);
const BASE_FIELDS: ReadonlySet<string> = new Set(ROWS_BASE_COLUMNS);

/**
 * Asserts the runtime mirror of {@link CanCandle} on one row and returns the
 * requested volume column, if any.
 */
function assertCandleColumns(row: CandleRow): VolumeColumn | undefined {
  const columns = Object.keys(row).filter((column) => !BASE_FIELDS.has(column));
  for (const column of OHLC_COLUMNS) {
    assert(columns.includes(column), `candles() requires the ${column} column`);
  }

  const extras = columns.filter((column) => !OHLC_SET.has(column));
  if (extras.length === 0) return undefined;

  const [extra] = extras;
  assert(
    extras.length === 1 && extra !== undefined && VOLUME_SET.has(extra),
    () => `candles() allows only OHLC and one volume column, got: ${columns.join(", ")}`,
  );
  return extra as VolumeColumn;
}

/**
 * Reads one column of a non-empty bucket, asserting it is present and
 * non-null.
 */
function columnValue(row: CandleRow, column: OhlcColumn | VolumeColumn): number {
  const value = row[column];
  assert(
    value !== null && value !== undefined,
    () => `Bucket at time ${row.time}: ${column} is null in a non-empty bucket`,
  );
  return value;
}
