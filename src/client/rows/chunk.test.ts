import { describe, expect, it } from "vitest";

import { VeloError } from "../../errors.js";
import { chunkRange, MAX_CELLS_PER_REQUEST } from "./chunk.js";
import type { ValidatedRowsParams } from "./params.js";

const MINUTE = 60_000;

function params(overrides: Partial<ValidatedRowsParams> = {}): ValidatedRowsParams {
  return {
    exchanges: ["binance-futures"],
    products: ["BTCUSDT"],
    columns: ["close_price"],
    begin: 0,
    end: MINUTE,
    resolution: "1m",
    ...overrides,
  };
}

describe("chunkRange", () => {
  it("keeps a range that fits in one request", () => {
    const range = { begin: 0, end: MAX_CELLS_PER_REQUEST * MINUTE };
    expect(chunkRange(params(), range)).toEqual([range]);
  });

  it("prices each bucket by exchanges x selectors x columns", () => {
    const range = { begin: 0, end: 1_500 * MINUTE };
    const chunks = chunkRange(
      params({
        exchanges: ["binance-futures", "bybit"],
        products: ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
        columns: ["open_price", "high_price", "low_price", "close_price", "coin_volume"],
      }),
      range,
    );

    expect(chunks).toEqual([
      { begin: 0, end: 750 * MINUTE },
      { begin: 750 * MINUTE, end: 1_500 * MINUTE },
    ]);
  });

  it("prices basis queries as three exchanges", () => {
    const basis: ValidatedRowsParams = {
      coins: ["BTC", "ETH"],
      columns: ["3m_basis_ann"],
      begin: 0,
      end: MINUTE,
      resolution: "1m",
    };
    const chunks = chunkRange(basis, { begin: 0, end: 4_000 * MINUTE });

    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.end).toBe(3_750 * MINUTE);
  });

  it("uses one request per calendar month", () => {
    expect(
      chunkRange(params({ resolution: "1M" }), {
        begin: Date.UTC(2026, 0, 1),
        end: Date.UTC(2026, 3, 1),
      }),
    ).toEqual([
      { begin: Date.UTC(2026, 0, 1), end: Date.UTC(2026, 1, 1) },
      { begin: Date.UTC(2026, 1, 1), end: Date.UTC(2026, 2, 1) },
      { begin: Date.UTC(2026, 2, 1), end: Date.UTC(2026, 3, 1) },
    ]);
  });

  it("rejects invalid ranges and over-wide buckets", () => {
    expect(() => chunkRange(params(), { begin: 0, end: 0 })).toThrow(VeloError);
    expect(() =>
      chunkRange(
        params({
          exchanges: Array.from({ length: 8 }, () => "binance-futures"),
          products: Array.from({ length: 300 }, (_, index) => `P${index}`),
          columns: Array.from({ length: 10 }, () => "close_price"),
        }),
        { begin: 0, end: MINUTE },
      ),
    ).toThrow(/too wide/);
  });
});
