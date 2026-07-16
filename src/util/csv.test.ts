import { describe, expect, it } from "vitest";

import { VeloError } from "../errors.js";
import type { CsvSchema } from "./csv.js";
import { decodeCsv } from "./csv.js";

const ROWS_SCHEMA: CsvSchema = {
  exchange: "string",
  coin: "string",
  product: "string",
  time: "number",
  close_price: "nullable-number",
};

describe("decodeCsv", () => {
  it("decodes the rows example from the OpenAPI spec", () => {
    const text =
      "exchange,coin,product,time,close_price\n" +
      "binance-futures,BTC,BTCUSDT,1767225600000,87824.6\n" +
      "binance-futures,ETH,ETHUSDT,1767225600000,2979.01\n";
    expect(decodeCsv(text, ROWS_SCHEMA, "/rows")).toEqual([
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

  it("decodes the caps example from the OpenAPI spec", () => {
    const schema: CsvSchema = {
      coin: "string",
      time: "number",
      circ: "nullable-number",
      circ_dollars: "nullable-number",
      fdv: "nullable-number",
      fdv_dollars: "nullable-number",
    };
    const text =
      "coin,time,circ,circ_dollars,fdv,fdv_dollars\n" +
      "BTC,1783513513252,20053612,1248112746545.6,20053612,1248112746545.6\n";
    expect(decodeCsv(text, schema, "/caps")).toEqual([
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

  it("keeps numeric-looking text in string columns as strings", () => {
    // a coin ticker that happens to parse as a number must not become one
    const text = "exchange,coin,product,time,close_price\nbinance,888,888USDT,1,2\n";
    expect(decodeCsv(text, ROWS_SCHEMA, "/rows")).toEqual([
      { exchange: "binance", coin: "888", product: "888USDT", time: 1, close_price: 2 },
    ]);
  });

  it("decodes empty and SQL-NULL nullable cells as null", () => {
    const text = "exchange,coin,product,time,close_price\nbinance,BTC,BTCUSDT,1,null\n";
    expect(decodeCsv(text, ROWS_SCHEMA, "/rows")[0]?.close_price).toBeNull();
    const missing = "exchange,coin,product,time,close_price\nbinance,BTC,BTCUSDT,1\n";
    expect(decodeCsv(missing, ROWS_SCHEMA, "/rows")[0]?.close_price).toBeNull();
  });

  it("rejects non-numeric or null cells in number columns", () => {
    for (const time of ["not-a-time", "null", ""]) {
      const text = `exchange,coin,product,time,close_price\nbinance,BTC,BTCUSDT,${time},2\n`;
      expect(() => decodeCsv(text, ROWS_SCHEMA, "/rows")).toThrow(VeloError);
      expect(() => decodeCsv(text, ROWS_SCHEMA, "/rows")).toThrow(/column time expected a number/);
    }
  });

  it("rejects non-numeric cells in nullable-number columns", () => {
    const text = "exchange,coin,product,time,close_price\nbinance,BTC,BTCUSDT,1,not-a-number\n";
    expect(() => decodeCsv(text, ROWS_SCHEMA, "/rows")).toThrow(/column close_price/);
  });

  it("rejects empty cells in string columns", () => {
    const text = "exchange,coin,product,time,close_price\n,BTC,BTCUSDT,1,2\n";
    expect(() => decodeCsv(text, ROWS_SCHEMA, "/rows")).toThrow(/column exchange is empty/);
  });

  it("rejects a header that differs from the schema", () => {
    const text = "exchange,coin,product,time,open_price\nbinance,BTC,BTCUSDT,1,2\n";
    expect(() => decodeCsv(text, ROWS_SCHEMA, "/rows")).toThrow(
      /unexpected \/rows response header/,
    );
  });

  it("handles CRLF line endings", () => {
    const schema: CsvSchema = { a: "number", b: "string" };
    expect(decodeCsv("a,b\r\n1,x\r\n", schema, "/x")).toEqual([{ a: 1, b: "x" }]);
  });

  it("decodes an empty body and a header-only body as no rows", () => {
    expect(decodeCsv("", ROWS_SCHEMA, "/rows")).toEqual([]);
    expect(decodeCsv("exchange,coin,product,time,close_price\n", ROWS_SCHEMA, "/rows")).toEqual([]);
  });
});
