import { assert } from "../../util/assert.ts";
import type { Candle, CanCandle } from "./candles.ts";
import { toCandles } from "./candles.ts";
import type { ProductKey } from "./product-key.ts";
import { formatProductKey } from "./product-key.ts";
import { Row, type RowBase, type RowColumns } from "./row.ts";

/*//////////////////////////////////////////////////////////////
                             SERIES
//////////////////////////////////////////////////////////////*/

type Series<E extends string, C extends string> = ReadonlyMap<ProductKey<E>, readonly Row<E, C>[]>;

const Series = Object.freeze({
  /** Groups rows by series, asserting each series' times stay ascending. */
  create<E extends string, C extends string>(rows: readonly Row<E, C>[]): Series<E, C> {
    const series = new Map<ProductKey<E>, Row<E, C>[]>();
    for (const row of rows) {
      const key = formatProductKey(row.exchange, row.product);
      const group = series.get(key);
      if (group === undefined) {
        series.set(key, [row]);
        continue;
      }

      const last = group[group.length - 1]!;
      assert(
        row.time > last.time,
        () => `Rows for ${key} are not time-ascending: ${row.time} after ${last.time}`,
      );
      group.push(row);
    }
    return series;
  },

  /** Applies `transform` to every series, preserving key order. */
  map<E extends string, C extends string, V>(
    series: Series<E, C>,
    transform: (rows: readonly Row<E, C>[]) => V,
  ): ReadonlyMap<ProductKey<E>, V> {
    const result = new Map<ProductKey<E>, V>();
    for (const [key, rows] of series) {
      result.set(key, transform(rows));
    }
    return result;
  },
});

/*//////////////////////////////////////////////////////////////
                         SERIES COLUMNS
//////////////////////////////////////////////////////////////*/

/**
 * One series in columnar form. Each array holds one value per bucket,
 * index-aligned with `time`; `NaN` encodes SQL NULL (decoded values are
 * otherwise always finite).
 *
 * @typeParam E - Exchanges the market may return.
 * @typeParam C - Columns requested by the query.
 */
export interface SeriesColumns<E extends string, C extends string> {
  readonly exchange: E;
  readonly coin: string;
  readonly product: string;
  readonly time: Float64Array;
  readonly values: { readonly [K in C]: Float64Array };
}

const BASE_FIELDS: ReadonlySet<string> = new Set(Row.columns);

export const SeriesColumns = Object.freeze({
  /** Builds the columnar view of one series. */
  create<E extends string, C extends string>(rows: readonly Row<E, C>[]): SeriesColumns<E, C> {
    const first = rows[0];
    assert(first !== undefined, "Cannot build columns for an empty series");

    const names = Object.keys(first).filter((name) => !BASE_FIELDS.has(name)) as C[];
    const time = new Float64Array(rows.length);
    const values = Object.fromEntries(
      names.map((name) => [name, new Float64Array(rows.length)]),
    ) as Record<C, Float64Array>;

    for (const [index, row] of rows.entries()) {
      time[index] = row.time;
      for (const name of names) {
        values[name][index] = row[name] ?? NaN;
      }
    }
    return { exchange: first.exchange, coin: first.coin, product: first.product, time, values };
  },
});

/*//////////////////////////////////////////////////////////////
                              DATA
//////////////////////////////////////////////////////////////*/

/**
 * The result of an executed rows query: lazily computed, cached views over
 * the decoded rows.
 *
 * @typeParam E - Exchanges the market may return.
 * @typeParam C - Columns requested by the query.
 */
export type Data<E extends string, C extends string> = Iterable<Row<E, C>> & {
  /**
   * Iterates the flat rows, equivalent to iterating {@link Data#rows | rows()}.
   */
  [Symbol.iterator](): Iterator<Row<E, C>>;

  /** The flat rows in response order, with series interleaved. */
  rows(): readonly Row<E, C>[];

  /**
   * Groups the rows into one entry per series.
   *
   * Entries appear in first-appearance order; rows within an entry keep
   * their time-ascending response order.
   */
  series(): Series<E, C>;

  /** Converts every series to columnar form. */
  columns(): ReadonlyMap<ProductKey<E>, SeriesColumns<E, C>>;
};

/**
 * A rows-query result whose selected columns can be converted to candles.
 */
export interface CandleData<E extends string, C extends string> extends Data<E, C> {
  /**
   * Converts every series to candles.
   *
   * Buckets whose OHLC values are all null (no trades) are skipped.
   */
  candles(): ReadonlyMap<ProductKey<E>, readonly Candle[]>;
}

/**
 * Resolves a row selection to its public result capability.
 *
 * Candle conversion is exposed only when the selected columns contain all
 * four OHLC prices, at most one total-volume column, and no other columns.
 */
export type DataResult<E extends string, C extends string> =
  CanCandle<C> extends true ? CandleData<E, C> : Data<E, C>;

interface DataConstructor {
  readonly prototype: Data<string, never>;

  /** Creates data while inferring exchanges and columns from the row type. */
  new <R extends RowBase>(rows: readonly R[]): DataResult<R["exchange"], RowColumns<R>>;

  /** Creates data with explicit exchange and column type parameters. */
  new <E extends string, C extends string>(rows: readonly Row<E, C>[]): DataResult<E, C>;

  /**
   * Builds data from already-decoded rows, inferring exchanges and columns
   * from the row type — for example rows accumulated from `stream()`.
   */
  from<R extends RowBase>(rows: readonly R[]): DataResult<R["exchange"], RowColumns<R>>;
}

const DataImplementation = class Data<E extends string, C extends string> implements CandleData<
  E,
  C
> {
  readonly #rows: readonly Row<E, C>[];
  #series: Series<E, C> | undefined;
  #columns: ReadonlyMap<ProductKey<E>, SeriesColumns<E, C>> | undefined;
  #candles: ReadonlyMap<ProductKey<E>, readonly Candle[]> | undefined;

  /**
   * @param rows - Decoded rows; each series' rows must be time-ascending.
   */
  constructor(rows: readonly Row<E, C>[]) {
    this.#rows = Object.freeze([...rows]);
  }

  /**
   * Builds a `Data` from already-decoded rows, inferring the exchange and
   * column type parameters from the row type — for example rows accumulated
   * from `stream()`.
   *
   * @param rows - Decoded rows; each series' rows must be time-ascending.
   */
  static from<R extends RowBase>(rows: readonly R[]): DataResult<R["exchange"], RowColumns<R>> {
    /* The cast is sound: R is exactly a row over its own column keys. */
    return new Data(rows as unknown as readonly Row<R["exchange"], RowColumns<R>>[]) as DataResult<
      R["exchange"],
      RowColumns<R>
    >;
  }

  /**
   * Iterates the flat rows, equivalent to iterating
   * {@link Data#rows | rows()}.
   */
  [Symbol.iterator](): Iterator<Row<E, C>> {
    return this.#rows[Symbol.iterator]();
  }

  /**
   * The flat rows in response order, with series interleaved.
   */
  rows(): readonly Row<E, C>[] {
    return this.#rows;
  }

  /**
   * Groups the rows into one entry per series.
   *
   * Entries appear in first-appearance order; rows within an entry keep
   * their time-ascending response order.
   */
  series(): Series<E, C> {
    this.#series ??= Series.create(this.#rows);
    return this.#series;
  }

  /**
   * Converts every series to columnar form.
   */
  columns(): ReadonlyMap<ProductKey<E>, SeriesColumns<E, C>> {
    this.#columns ??= Series.map(this.series(), SeriesColumns.create);
    return this.#columns;
  }

  /**
   * Converts every series to candles.
   *
   * Buckets whose OHLC values are all null (no trades) are skipped.
   */
  candles(): ReadonlyMap<ProductKey<E>, readonly Candle[]> {
    this.#candles ??= Series.map(this.series(), toCandles);
    return this.#candles;
  }
};

/** Creates lazily computed data views over already-decoded rows. */
export const Data = DataImplementation as DataConstructor;
