import { describe, expect, it } from "vitest";

import { chunkRange, MAX_CELLS_PER_REQUEST } from "./chunk.js";
import type { RowsParamsV1 } from "./param.js";
import { VeloError } from "./transport/error.js";

const MINUTE = 60_000;

function futures(overrides: Partial<RowsParamsV1> = {}): RowsParamsV1 {
  return {
    type: "futures",
    exchanges: ["binance-futures"],
    products: ["BTCUSDT"],
    columns: ["close_price"],
    begin: 0,
    end: MINUTE,
    resolution: "1m",
    ...overrides,
  } as RowsParamsV1;
}

/** Steps must be contiguous, cover [begin, end), and stay in order. */
function expectContiguous(steps: { begin: number; end: number }[], begin: number, end: number) {
  expect(steps[0]?.begin).toBe(begin);
  expect(steps.at(-1)?.end).toBe(end);
  for (let i = 1; i < steps.length; i++) {
    expect(steps[i]?.begin).toBe(steps[i - 1]?.end);
  }
}

describe("chunkRange", () => {
  it("returns the range unchanged when it fits the budget", () => {
    const range = { begin: 0, end: MAX_CELLS_PER_REQUEST * MINUTE };
    expect(chunkRange(futures(), range)).toEqual([range]);
  });

  it("splits ranges exceeding the budget into contiguous full-budget steps", () => {
    const range = { begin: 0, end: 30_000 * MINUTE }; // 30k 1m buckets, 1 cell each
    const steps = chunkRange(futures(), range);

    expect(steps).toHaveLength(2);
    expectContiguous(steps, range.begin, range.end);
    expect(steps[0]).toEqual({ begin: 0, end: MAX_CELLS_PER_REQUEST * MINUTE });
  });

  it("shrinks steps by the exchanges x products x columns cross-section", () => {
    const params = futures({
      exchanges: ["binance-futures", "bybit"],
      products: ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
      columns: ["open_price", "high_price", "low_price", "close_price", "coin_volume"],
    }); // 2 x 3 x 5 = 30 cells per bucket -> 750 buckets per step
    const range = { begin: 0, end: 1_500 * MINUTE };
    const steps = chunkRange(params, range);

    expect(steps).toHaveLength(2);
    expectContiguous(steps, range.begin, range.end);
    expect(steps[0]?.end).toBe(750 * MINUTE);
  });

  it("clamps the final step to the range end", () => {
    const range = { begin: 0, end: (MAX_CELLS_PER_REQUEST + 1) * MINUTE };
    const steps = chunkRange(futures(), range);

    expect(steps).toHaveLength(2);
    expect(steps[1]).toEqual({
      begin: MAX_CELLS_PER_REQUEST * MINUTE,
      end: range.end,
    });
  });

  it("prices basis queries at 3 exchanges regardless of the params", () => {
    const params: RowsParamsV1 = {
      type: "futures",
      coins: ["BTC", "ETH"],
      columns: ["3m_basis_ann"],
      begin: 0,
      end: MINUTE,
      resolution: "1m",
    }; // 3 x 2 x 1 = 6 cells per bucket -> 3750 buckets per step
    const range = { begin: 0, end: 4_000 * MINUTE };
    const steps = chunkRange(params, range);

    expect(steps).toHaveLength(2);
    expect(steps[0]?.end).toBe(3_750 * MINUTE);
  });

  it("splits months-mode ranges into one step per resolution month", () => {
    const range = { begin: Date.UTC(2026, 0, 1), end: Date.UTC(2026, 4, 1) };
    const steps = chunkRange(futures({ resolution: "1M" }), range);

    expect(steps).toEqual([
      { begin: Date.UTC(2026, 0, 1), end: Date.UTC(2026, 1, 1) },
      { begin: Date.UTC(2026, 1, 1), end: Date.UTC(2026, 2, 1) },
      { begin: Date.UTC(2026, 2, 1), end: Date.UTC(2026, 3, 1) },
      { begin: Date.UTC(2026, 3, 1), end: Date.UTC(2026, 4, 1) },
    ]);
  });

  it("throws when a single bucket already exceeds the budget", () => {
    const params = futures({
      exchanges: Array.from({ length: 8 }, () => "binance-futures"),
      products: Array.from({ length: 300 }, (_, i) => `P${i}`),
      columns: Array.from({ length: 10 }, () => "close_price"),
    } as Partial<RowsParamsV1>); // 8 x 300 x 10 = 24000 > 22500
    expect(() => chunkRange(params, { begin: 0, end: MINUTE })).toThrow(VeloError);
    expect(() => chunkRange(params, { begin: 0, end: MINUTE })).toThrow(/query too wide/);
  });
});
