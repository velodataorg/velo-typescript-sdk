import { describe, expect, expectTypeOf, it } from "vitest";

import { Data, type CandleData } from "./data.ts";
import type { Row } from "./row.ts";

type Ohlc = "open_price" | "high_price" | "low_price" | "close_price";

type OhlcValues = readonly [
  open: number | null,
  high: number | null,
  low: number | null,
  close: number | null,
];

function ohlcRow(time: number, [open, high, low, close]: OhlcValues): Row<"binance", Ohlc> {
  return {
    exchange: "binance",
    coin: "BTC",
    product: "BTCUSDT",
    time,
    open_price: open,
    high_price: high,
    low_price: low,
    close_price: close,
  };
}

describe("Data.candles", () => {
  it("exposes the candle view only when Data.from() receives compatible rows", () => {
    const compatible = Data.from([ohlcRow(1, [10, 12, 9, 11])]);
    const closeOnly: Row<"binance", "close_price"> = {
      exchange: "binance",
      coin: "BTC",
      product: "BTCUSDT",
      time: 1,
      close_price: 11,
    };
    const incompatible = Data.from([closeOnly]);

    expectTypeOf(compatible).toEqualTypeOf<CandleData<"binance", Ohlc>>();
    expectTypeOf(incompatible).toEqualTypeOf<Data<"binance", "close_price">>();
    expectTypeOf(compatible).toHaveProperty("candles");
    expectTypeOf(incompatible).not.toHaveProperty("candles");
  });

  it("converts each series' buckets to candles", () => {
    const data = Data.from([ohlcRow(1, [10, 12, 9, 11]), ohlcRow(2, [11, 14, 11, 13])]);

    expect([...data.candles().keys()]).toEqual(["binance:BTCUSDT"]);
    expect(data.candles().get("binance:BTCUSDT")).toStrictEqual([
      { time: 1, open: 10, high: 12, low: 9, close: 11 },
      { time: 2, open: 11, high: 14, low: 11, close: 13 },
    ]);
    expect(data.candles()).toBe(data.candles());
  });

  it("includes volume when a volume column was requested", () => {
    const data = Data.from([{ ...ohlcRow(1, [10, 12, 9, 11]), dollar_volume: 5000 }]);

    expect(data.candles().get("binance:BTCUSDT")).toStrictEqual([
      { time: 1, open: 10, high: 12, low: 9, close: 11, volume: 5000 },
    ]);
  });

  it("skips buckets whose OHLC values are all null", () => {
    const data = Data.from([ohlcRow(1, [null, null, null, null]), ohlcRow(2, [11, 14, 11, 13])]);

    expect(data.candles().get("binance:BTCUSDT")).toStrictEqual([
      { time: 2, open: 11, high: 14, low: 11, close: 13 },
    ]);
  });

  it("rejects a bucket with any single null OHLC value", () => {
    const buckets: readonly (readonly [OhlcValues, string])[] = [
      [[null, 12, 9, 11], "open_price"],
      [[10, null, 9, 11], "high_price"],
      [[10, 12, null, 11], "low_price"],
      [[10, 12, 9, null], "close_price"],
    ];

    for (const [values, column] of buckets) {
      const data = Data.from([ohlcRow(1, values)]);
      expect(() => data.candles()).toThrow(`Bucket at time 1: ${column} is null`);
    }
  });

  it("rejects a null volume in a non-empty bucket", () => {
    const coin = Data.from([{ ...ohlcRow(1, [10, 12, 9, 11]), coin_volume: null }]);
    const dollar = Data.from([{ ...ohlcRow(1, [10, 12, 9, 11]), dollar_volume: null }]);

    expect(() => coin.candles()).toThrow(/coin_volume is null/);
    expect(() => dollar.candles()).toThrow(/dollar_volume is null/);
  });

  it("mirrors the compile-time gate at runtime for cast-away columns", () => {
    const missing = new Data([
      { exchange: "binance", coin: "BTC", product: "BTCUSDT", time: 1, close_price: 11 },
    ] as unknown as Row<"binance", Ohlc>[]);
    const extra = new Data([{ ...ohlcRow(1, [10, 12, 9, 11]), buy_trades: 3 }] as unknown as Row<
      "binance",
      Ohlc
    >[]);
    const bothVolumes = new Data([
      { ...ohlcRow(1, [10, 12, 9, 11]), coin_volume: 2, dollar_volume: 5000 },
    ] as unknown as Row<"binance", Ohlc>[]);

    expect(() => missing.candles()).toThrow(/requires all four OHLC columns/);
    expect(() => extra.candles()).toThrow(/Unrecognized key: "buy_trades"/);
    expect(() => bothVolumes.candles()).toThrow(/mutually exclusive/);
  });

  it("types direct construction by its candle capability", () => {
    const ohlc = new Data<"binance", Ohlc>([]);
    const withVolume = new Data<"binance", Ohlc | "coin_volume">([]);
    const missingOhlc = new Data<"binance", "close_price">([]);
    const bothVolumes = new Data<"binance", Ohlc | "coin_volume" | "dollar_volume">([]);
    const extraColumn = new Data<"binance", Ohlc | "buy_trades">([]);

    expectTypeOf(ohlc).toEqualTypeOf<CandleData<"binance", Ohlc>>();
    expectTypeOf(withVolume).toEqualTypeOf<CandleData<"binance", Ohlc | "coin_volume">>();
    expectTypeOf(missingOhlc).toEqualTypeOf<Data<"binance", "close_price">>();
    expectTypeOf(bothVolumes).toEqualTypeOf<
      Data<"binance", Ohlc | "coin_volume" | "dollar_volume">
    >();
    expectTypeOf(extraColumn).toEqualTypeOf<Data<"binance", Ohlc | "buy_trades">>();
    expect(ohlc.candles().size).toBe(0);
    expect(withVolume.candles().size).toBe(0);
    // @ts-expect-error candles() requires all four OHLC columns
    expect(missingOhlc.candles().size).toBe(0);
    // @ts-expect-error candles() allows at most one volume column
    expect(bothVolumes.candles().size).toBe(0);
    // @ts-expect-error candles() allows no columns beyond OHLCV
    expect(extraColumn.candles().size).toBe(0);
  });
});
