import { describe, expect, it } from "vitest";

import { VeloError } from "../../errors.js";
import { MAX_CELLS_PER_REQUEST } from "./chunk.js";
import { prepareRows, resolutionParams } from "./rows.js";

describe("resolutionParams", () => {
  it("sends minutes for fixed-length resolutions", () => {
    expect(resolutionParams("1m")).toEqual({ resolution: 1 });
    expect(resolutionParams("12h")).toEqual({ resolution: 720 });
    expect(resolutionParams("1W")).toEqual({ resolution: 10_080 });
  });

  it("sends a month count with months=true for calendar resolutions", () => {
    expect(resolutionParams("1M")).toEqual({ resolution: 1, months: true });
  });
});

describe("prepareRows", () => {
  const params = {
    exchanges: ["binance-futures", "bybit"],
    products: ["BTCUSDT"],
    columns: ["close_price", "coin_volume"],
    begin: Date.UTC(2026, 0, 1, 7, 23, 45),
    end: Date.UTC(2026, 0, 1, 9, 0, 0, 1),
    resolution: "1h",
  } as const;

  it("lowers params to the path, one aligned wire request, and the schema", () => {
    const prepared = prepareRows("futures", params);

    expect(prepared.path).toBe("/api/v1/rows");
    expect(prepared.requests).toEqual([
      {
        type: "futures",
        exchanges: ["binance-futures", "bybit"],
        products: ["BTCUSDT"],
        columns: ["close_price", "coin_volume"],
        // begin floored, end ceiled to the 1h bucket
        begin: Date.UTC(2026, 0, 1, 7),
        end: Date.UTC(2026, 0, 1, 10),
        resolution: 60,
      },
    ]);
    expect(prepared.schema).toEqual({
      exchange: "string",
      coin: "string",
      product: "string",
      time: "number",
      close_price: "nullable-number",
      coin_volume: "nullable-number",
    });
  });

  it("lowers an over-budget range to one request per chunk", () => {
    const begin = Date.UTC(2026, 0, 1);
    const prepared = prepareRows("futures", {
      exchanges: ["binance-futures"],
      products: ["BTCUSDT"],
      columns: ["close_price"],
      begin,
      end: begin + 30_000 * 60_000, // 30k 1m buckets, 1 cell each -> 2 chunks
      resolution: "1m",
    });

    expect(prepared.requests).toHaveLength(2);
    expect(prepared.requests[0]).toMatchObject({
      begin,
      end: begin + MAX_CELLS_PER_REQUEST * 60_000,
    });
    expect(prepared.requests[1]).toMatchObject({
      begin: begin + MAX_CELLS_PER_REQUEST * 60_000,
      end: begin + 30_000 * 60_000,
    });
  });

  it("lowers the 1M resolution to calendar-month requests with months=true", () => {
    const prepared = prepareRows("futures", {
      ...params,
      begin: Date.UTC(2026, 0, 15),
      end: Date.UTC(2026, 2, 15),
      resolution: "1M",
    });

    expect(prepared.requests).toHaveLength(3); // aligned to [Jan 1, Apr 1)
    expect(prepared.requests[0]).toMatchObject({
      begin: Date.UTC(2026, 0, 1),
      end: Date.UTC(2026, 1, 1),
      resolution: 1,
      months: true,
    });
  });

  it("copies the caller's arrays: mutating them later cannot change the requests", () => {
    const products = ["BTCUSDT"];
    const columns: "close_price"[] = ["close_price"];
    const prepared = prepareRows("futures", { ...params, products, columns });

    products.push("ETHUSDT"); // would widen the request past what was validated
    columns.push("close_price");

    expect(prepared.requests[0]?.products).toEqual(["BTCUSDT"]);
    expect(prepared.requests[0]?.columns).toEqual(["close_price"]);
  });

  it("rejects invalid params before lowering, and over-wide queries while lowering", () => {
    expect(() => prepareRows("futures", { ...params, columns: [] as never })).toThrow(VeloError);
    expect(() =>
      prepareRows("futures", {
        exchanges: ["binance-futures"],
        // 30000 cells per bucket exceeds the 22500 budget
        products: Array.from({ length: 30_000 }, (_, i) => `P${i}`),
        columns: ["close_price"],
        begin: 0,
        end: 60_000,
        resolution: "1m",
      }),
    ).toThrow(/query too wide/);
  });
});
