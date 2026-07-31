import { describe, expect, it } from "vitest";

import { decodeOrderbook } from "./decode.js";

describe("decodeOrderbook", () => {
  it("decodes the step line and variable-width bucket lines", () => {
    const rows = decodeOrderbook("15\n1000,100.5,95,1.5,110,2\n61000,101,96,3\n");

    expect(rows).toEqual([
      {
        time: 1000,
        mid: 100.5,
        step: 15,
        prices: Float64Array.from([95, 110]),
        sizes: Float64Array.from([1.5, 2]),
      },
      {
        time: 61000,
        mid: 101,
        step: 15,
        prices: Float64Array.from([96]),
        sizes: Float64Array.from([3]),
      },
    ]);
  });

  it("decodes a bucket with no levels", () => {
    expect(decodeOrderbook("15\n1000,100.5")).toEqual([
      { time: 1000, mid: 100.5, step: 15, prices: new Float64Array(0), sizes: new Float64Array(0) },
    ]);
  });

  it("accepts fractional steps, CRLF line endings, and a size of zero", () => {
    const rows = decodeOrderbook("1.5\r\n1000,100,99,0\r\n");

    expect(rows).toEqual([
      {
        time: 1000,
        mid: 100,
        step: 1.5,
        prices: Float64Array.from([99]),
        sizes: Float64Array.from([0]),
      },
    ]);
  });

  it("returns no rows for an empty or step-only body", () => {
    expect(decodeOrderbook("")).toEqual([]);
    expect(decodeOrderbook("\n")).toEqual([]);
    expect(decodeOrderbook("15\n")).toEqual([]);
  });

  it("rejects a malformed step line", () => {
    expect(() => decodeOrderbook("steps (minutes / reso) 600 > 512\n")).toThrow(
      /not a positive price-grid step/,
    );
    expect(() => decodeOrderbook("0\n1000,100")).toThrow(/not a positive price-grid step/);
    expect(() => decodeOrderbook("-15\n1000,100")).toThrow(/not a positive price-grid step/);
  });

  it("rejects lines with an odd or short cell count", () => {
    expect(() => decodeOrderbook("15\n1000,100,99\n")).toThrow(/Line 2 has 3 cells/);
    expect(() => decodeOrderbook("15\n1000\n")).toThrow(/Line 2 has 1 cells/);
    expect(() => decodeOrderbook("15\n\n1000,100\n")).toThrow(/Line 2 has 1 cells/);
  });

  it("rejects malformed times", () => {
    expect(() => decodeOrderbook("15\nlater,100\n")).toThrow(/time "later"/);
    expect(() => decodeOrderbook("15\n1000.5,100\n")).toThrow(/time "1000.5"/);
    expect(() => decodeOrderbook("15\n-1000,100\n")).toThrow(/time "-1000"/);
    expect(() => decodeOrderbook("15\n8640000000000001,100\n")).toThrow(/time/);
  });

  it("accepts the epoch and leaves cross-row ordering to OrderbookData", () => {
    const rows = decodeOrderbook("15\n2000,100\n0,101\n");
    expect(rows.map((row) => row.time)).toEqual([2000, 0]);
  });

  it("returns no rows for a body of blank lines", () => {
    expect(decodeOrderbook("\n\n")).toEqual([]);
    expect(decodeOrderbook("15\r\n")).toEqual([]);
  });

  it("rejects an empty cell inside a level pair", () => {
    expect(() => decodeOrderbook("15\n1000,100,,1\n")).toThrow(/level 0 price ""/);
    expect(() => decodeOrderbook("15\n1000,100,99,\n")).toThrow(/level 0 size ""/);
  });

  it("rejects malformed mids", () => {
    expect(() => decodeOrderbook("15\n1000,\n")).toThrow(/mid ""/);
    expect(() => decodeOrderbook("15\n1000,0\n")).toThrow(/mid "0"/);
    expect(() => decodeOrderbook("15\n1000,NaN\n")).toThrow(/mid "NaN"/);
  });

  it("rejects malformed levels", () => {
    expect(() => decodeOrderbook("15\n1000,100, ,1\n")).toThrow(/level 0 price " "/);
    expect(() => decodeOrderbook("15\n1000,100,0,1\n")).toThrow(/level 0 price "0"/);
    expect(() => decodeOrderbook("15\n1000,100,99,-1\n")).toThrow(/level 0 size "-1"/);
    expect(() => decodeOrderbook("15\n1000,100,99,Infinity\n")).toThrow(/level 0 size "Infinity"/);
  });

  it("rejects level prices that are not strictly ascending", () => {
    expect(() => decodeOrderbook("15\n1000,100,99,1,99,2\n")).toThrow(/not ascending: 99 after 99/);
    expect(() => decodeOrderbook("15\n1000,100,99,1,98,2\n")).toThrow(/not ascending: 98 after 99/);
  });
});
