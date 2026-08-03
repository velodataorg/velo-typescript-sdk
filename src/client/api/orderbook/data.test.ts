import { describe, expect, it } from "vitest";

import { VeloError } from "../../../errors.ts";
import type { OrderbookRow } from "./data.ts";
import { OrderbookData } from "./data.ts";

function row(
  time: number,
  mid: number,
  levels: readonly (readonly [number, number])[],
): OrderbookRow {
  return {
    time,
    mid,
    step: 15,
    prices: Float64Array.from(levels, ([price]) => price),
    sizes: Float64Array.from(levels, ([, size]) => size),
  };
}

describe("OrderbookData", () => {
  it("exposes rows in construction order and iterates them", () => {
    const rows = [row(1_000, 100, [[95, 1]]), row(2_000, 101, [[96, 2]])];
    const data = new OrderbookData(rows);

    expect(data.rows()).toEqual(rows);
    expect([...data]).toEqual(rows);
  });

  it("copies the caller's array and freezes its own", () => {
    const rows = [row(1_000, 100, [[95, 1]])];
    const data = new OrderbookData(rows);

    rows.push(row(2_000, 101, [[96, 2]]));

    expect(data.rows()).toHaveLength(1);
    expect(Object.isFrozen(data.rows())).toBe(true);
  });

  it("rejects rows whose times are not strictly ascending", () => {
    const flat = [row(1_000, 100, []), row(1_000, 100, [])];
    const backwards = [row(2_000, 100, []), row(1_000, 100, [])];

    expect(() => new OrderbookData(flat)).toThrow(VeloError);
    expect(() => new OrderbookData(backwards)).toThrow(/not time-ascending/);
  });

  it("splits snapshots around mid with best levels first", () => {
    const data = new OrderbookData([
      row(1_000, 100, [
        [97, 1],
        [98.5, 2],
        [99, 3],
        [101, 4],
        [102.5, 5],
      ]),
    ]);

    expect(data.snapshots()).toEqual([
      {
        time: 1_000,
        mid: 100,
        bids: [
          { price: 99, size: 3 },
          { price: 98.5, size: 2 },
          { price: 97, size: 1 },
        ],
        asks: [
          { price: 101, size: 4 },
          { price: 102.5, size: 5 },
        ],
      },
    ]);
  });

  it("counts a level exactly at mid as an ask", () => {
    const data = new OrderbookData([
      row(1_000, 100, [
        [99, 1],
        [100, 2],
        [101, 3],
      ]),
    ]);

    const snapshot = data.snapshots()[0]!;
    expect(snapshot.bids).toEqual([{ price: 99, size: 1 }]);
    expect(snapshot.asks).toEqual([
      { price: 100, size: 2 },
      { price: 101, size: 3 },
    ]);
  });

  it("caches the snapshots view", () => {
    const data = new OrderbookData([row(1_000, 100, [[95, 1]])]);
    expect(data.snapshots()).toBe(data.snapshots());
  });

  it("converts single rows by index, counting negatives from the end", () => {
    const data = new OrderbookData([row(1_000, 100, [[95, 1]]), row(2_000, 101, [[102, 2]])]);

    expect(data.snapshotAt(-1)).toMatchObject({ time: 2_000, asks: [{ price: 102, size: 2 }] });
    expect(data.snapshotAt(0)).toMatchObject({ time: 1_000, bids: [{ price: 95, size: 1 }] });
    expect(data.snapshotAt(2)).toBeUndefined();
    expect(data.snapshotAt(-3)).toBeUndefined();
  });

  it("shares one snapshot cache between snapshotAt and snapshots", () => {
    const data = new OrderbookData([row(1_000, 100, [[95, 1]])]);

    expect(data.snapshotAt(0)).toBe(data.snapshotAt(-1));
    expect(data.snapshots()[0]).toBe(data.snapshotAt(0));
  });

  it("handles empty data", () => {
    const data = new OrderbookData([]);
    expect(data.rows()).toEqual([]);
    expect(data.snapshots()).toEqual([]);
  });

  it("produces one-sided books when mid sits outside the level band", () => {
    const levels: readonly (readonly [number, number])[] = [
      [95, 1],
      [96, 2],
    ];
    const allAsks = new OrderbookData([row(1_000, 90, levels)]);
    const allBids = new OrderbookData([row(1_000, 200, levels)]);

    expect(allAsks.snapshotAt(0)).toMatchObject({
      bids: [],
      asks: [
        { price: 95, size: 1 },
        { price: 96, size: 2 },
      ],
    });
    expect(allBids.snapshotAt(0)).toMatchObject({
      bids: [
        { price: 96, size: 2 },
        { price: 95, size: 1 },
      ],
      asks: [],
    });
  });

  it("converts a bucket with no levels into an empty book", () => {
    const data = new OrderbookData([row(1_000, 100, [])]);
    expect(data.snapshotAt(0)).toEqual({ time: 1_000, mid: 100, bids: [], asks: [] });
  });

  it("freezes the snapshots view", () => {
    const data = new OrderbookData([row(1_000, 100, [[95, 1]])]);
    expect(Object.isFrozen(data.snapshots())).toBe(true);
  });

  it("returns undefined for a fractional index", () => {
    const data = new OrderbookData([row(1_000, 100, [[95, 1]])]);
    expect(data.snapshotAt(0.5)).toBeUndefined();
  });
});
