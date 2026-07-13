import { describe, expect, it } from "vitest";

import { parseCsv, parseCsvValue } from "./csv.js";

describe("parseCsvValue", () => {
  it("infers value types per cell", () => {
    expect(parseCsvValue("")).toBeNull();
    expect(parseCsvValue("true")).toBe(true);
    expect(parseCsvValue("false")).toBe(false);
    expect(parseCsvValue("87824.6")).toBe(87824.6);
    expect(parseCsvValue("1767225600000")).toBe(1767225600000);
    expect(parseCsvValue("BTCUSDT")).toBe("BTCUSDT");
    expect(parseCsvValue("1INCH")).toBe("1INCH");
    expect(parseCsvValue("binance-futures")).toBe("binance-futures");
  });
});

describe("parseCsv", () => {
  it("parses the rows example from the OpenAPI spec", () => {
    const text =
      "exchange,coin,product,time,close_price\n" +
      "binance-futures,BTC,BTCUSDT,1767225600000,87824.6\n" +
      "binance-futures,ETH,ETHUSDT,1767225600000,2979.01\n";
    expect(parseCsv(text)).toEqual([
      {
        exchange: "binance-futures",
        coin: "BTC",
        product: "BTCUSDT",
        time: 1767225600000,
        close_price: 87824.6,
      },
      {
        exchange: "binance-futures",
        coin: "ETH",
        product: "ETHUSDT",
        time: 1767225600000,
        close_price: 2979.01,
      },
    ]);
  });

  it("parses the caps example from the OpenAPI spec", () => {
    const text =
      "coin,time,circ,circ_dollars,fdv,fdv_dollars\n" +
      "BTC,1783513513252,20053612,1248112746545.6,20053612,1248112746545.6\n";
    expect(parseCsv(text)).toEqual([
      {
        coin: "BTC",
        time: 1783513513252,
        circ: 20053612,
        circ_dollars: 1248112746545.6,
        fdv: 20053612,
        fdv_dollars: 1248112746545.6,
      },
    ]);
  });

  it("fills missing trailing cells with null", () => {
    expect(parseCsv("a,b,c\n1,2\n")).toEqual([{ a: 1, b: 2, c: null }]);
  });

  it("handles CRLF line endings", () => {
    expect(parseCsv("a,b\r\n1,x\r\n")).toEqual([{ a: 1, b: "x" }]);
  });

  it("returns [] for empty or header-only bodies", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("a,b\n")).toEqual([]);
  });
});
