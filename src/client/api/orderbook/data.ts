import { assert } from "../../../util/assert.js";

/**
 * One time bucket of orderbook depth in columnar form.
 *
 * Levels span roughly ±5% around `mid`, quantized to the product's
 * server-chosen price grid.
 */
export interface OrderbookRow {
  readonly time: number;
  readonly mid: number;
  /** Width of one price bucket, from the response's leading grid line. */
  readonly step: number;
  /** Level prices in ascending order: bids below `mid`, asks above. */
  readonly prices: Float64Array;
  /** Resting base-asset size at each price, index-aligned with `prices`. */
  readonly sizes: Float64Array;
}

/** One price level of an orderbook side. */
export interface OrderbookLevel {
  readonly price: number;
  readonly size: number;
}

/**
 * One time bucket as a conventional two-sided book.
 *
 * A level priced exactly at `mid` counts as an ask, so both sides together
 * always carry every level of the row.
 */
export interface OrderbookSnapshot {
  readonly time: number;
  readonly mid: number;
  /** Levels below `mid`, best-first (descending price). */
  readonly bids: readonly OrderbookLevel[];
  /** Levels at or above `mid`, best-first (ascending price). */
  readonly asks: readonly OrderbookLevel[];
}

/**
 * The result of an executed orderbook query: lazily computed, cached views
 * over the decoded rows.
 */
export class OrderbookData implements Iterable<OrderbookRow> {
  readonly #rows: readonly OrderbookRow[];
  readonly #snapshotCache: (OrderbookSnapshot | undefined)[] = [];
  #snapshots: readonly OrderbookSnapshot[] | undefined;

  /**
   * @param rows - Decoded rows; times must be strictly ascending.
   */
  constructor(rows: readonly OrderbookRow[]) {
    for (let index = 1; index < rows.length; index++) {
      const previous = rows[index - 1]!;
      const row = rows[index]!;
      assert(
        row.time > previous.time,
        () => `Orderbook rows are not time-ascending: ${row.time} after ${previous.time}`,
      );
    }
    this.#rows = Object.freeze([...rows]);
  }

  /**
   * Iterates the rows, equivalent to iterating {@link OrderbookData#rows | rows()}.
   */
  [Symbol.iterator](): Iterator<OrderbookRow> {
    return this.#rows[Symbol.iterator]();
  }

  /**
   * The rows in time-ascending order.
   */
  rows(): readonly OrderbookRow[] {
    return this.#rows;
  }

  /**
   * Converts every row into a two-sided book, best levels first.
   */
  snapshots(): readonly OrderbookSnapshot[] {
    this.#snapshots ??= Object.freeze(this.#rows.map((_, index) => this.snapshotAt(index)!));
    return this.#snapshots;
  }

  /**
   * Converts one row into a two-sided book without materializing the others.
   *
   * Each conversion is cached, and {@link OrderbookData#snapshots | snapshots()}
   * shares the same cache.
   *
   * @param index - The row index; negative counts back from the end, so -1
   * is the latest bucket.
   * @returns The snapshot, or undefined when the index is out of range.
   */
  snapshotAt(index: number): OrderbookSnapshot | undefined {
    const resolved = index < 0 ? this.#rows.length + index : index;
    const row = this.#rows[resolved];
    if (row === undefined) return undefined;
    return (this.#snapshotCache[resolved] ??= toSnapshot(row));
  }
}

/**
 * Splits one row's ascending levels into bid and ask sides.
 */
function toSnapshot(row: OrderbookRow): OrderbookSnapshot {
  const { prices, sizes } = row;
  const split = lowestAskIndex(prices, row.mid);

  const bids = Array.from({ length: split }, (_, index) => {
    const level = split - 1 - index;
    return { price: prices[level]!, size: sizes[level]! };
  });
  const asks = Array.from({ length: prices.length - split }, (_, index) => ({
    price: prices[split + index]!,
    size: sizes[split + index]!,
  }));

  return { time: row.time, mid: row.mid, bids, asks };
}

/**
 * Binary-searches ascending prices for the first level at or above mid.
 */
function lowestAskIndex(prices: Float64Array, mid: number): number {
  let low = 0;
  let high = prices.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (prices[middle]! < mid) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}
