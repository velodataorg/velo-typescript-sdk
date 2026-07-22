import { describe, expect, it } from "vitest";

import { VeloError } from "../../../errors.js";
import { Data } from "./data.js";
import type { Row } from "./row.js";

type TestExchange = "binance" | "bybit";
type TestColumn = "close_price" | "dollar_volume";
type TestRow = Row<TestExchange, TestColumn>;

function row(
  exchange: TestExchange,
  time: number,
  close: number | null,
  volume: number | null,
): TestRow {
  return {
    exchange,
    coin: "BTC",
    product: "BTCUSDT",
    time,
    close_price: close,
    dollar_volume: volume,
  };
}

/* Two series interleaved by time, with a shared timestamp per bucket. */
const ROWS: TestRow[] = [
  row("binance", 1, 100, 5),
  row("bybit", 1, 101, 6),
  row("binance", 2, 102, null),
  row("bybit", 2, null, null),
];

describe("Data.rows", () => {
  it("returns a frozen copy detached from the input array", () => {
    const input = [row("binance", 1, 100, 5)];
    const data = Data.from(input);
    input.push(row("binance", 2, 102, 7));

    expect(data.rows()).toHaveLength(1);
    expect(Object.isFrozen(data.rows())).toBe(true);
  });

  it("iterates the flat rows", () => {
    expect([...Data.from(ROWS)]).toEqual(ROWS);
  });
});

describe("Data.series", () => {
  it("groups by exchange:product in first-appearance order", () => {
    const data = Data.from(ROWS);
    const series = data.series();

    expect([...series.keys()]).toEqual(["binance:BTCUSDT", "bybit:BTCUSDT"]);
    expect(series.get("binance:BTCUSDT")).toEqual([ROWS[0], ROWS[2]]);
    expect(series.get("bybit:BTCUSDT")).toEqual([ROWS[1], ROWS[3]]);
    expect(data.series()).toBe(series);
  });

  it("rejects rows that are not time-ascending within one series", () => {
    const outOfOrder = Data.from([row("binance", 2, 102, 7), row("binance", 1, 100, 5)]);
    const duplicate = Data.from([row("binance", 1, 100, 5), row("binance", 1, 100, 5)]);

    expect(() => outOfOrder.series()).toThrow(VeloError);
    expect(() => duplicate.series()).toThrow(VeloError);
  });
});

describe("Data.columns", () => {
  it("builds index-aligned arrays per series with NaN for null", () => {
    const data = Data.from(ROWS);
    const columns = data.columns();
    const bybit = columns.get("bybit:BTCUSDT");

    expect([...columns.keys()]).toEqual(["binance:BTCUSDT", "bybit:BTCUSDT"]);
    expect(bybit?.exchange).toBe("bybit");
    expect(bybit?.coin).toBe("BTC");
    expect(bybit?.product).toBe("BTCUSDT");
    expect(bybit?.time).toBeInstanceOf(Float64Array);
    expect(Array.from(bybit?.time ?? [])).toEqual([1, 2]);
    expect(Array.from(bybit?.values.close_price ?? [])).toEqual([101, NaN]);
    expect(Array.from(bybit?.values.dollar_volume ?? [])).toEqual([6, NaN]);
    expect(data.columns()).toBe(columns);
  });
});

describe("Data over an empty result", () => {
  it("returns empty views", () => {
    const data = new Data<TestExchange, TestColumn>([]);

    expect(data.rows()).toEqual([]);
    expect(data.series().size).toBe(0);
    expect(data.columns().size).toBe(0);
  });
});
