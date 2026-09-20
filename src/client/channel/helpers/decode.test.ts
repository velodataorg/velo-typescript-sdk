import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import { VeloError } from "../../../errors.ts";
import type { Row } from "../../data/row.ts";
import { aggregatedDecoder, singleDecoder } from "./decode.ts";
import type { ExchangeEntry } from "./decode.ts";

const BTC = { exchange: "bybit", coin: "BTC", product: "BTCUSDT" } as const;
const EXCHANGES = ["bybit", "deribit"] as const;
const pair = z.tuple([z.number(), z.number()]);
const columns = ([low, high]: z.infer<typeof pair>) => ({ low_price: low, high_price: high });

describe("singleDecoder", () => {
  const decode = singleDecoder("realtime_bybit:BTCUSDT", BTC, pair, columns);

  it("decodes a frame to a history row: the product, its minute, then the columns", () => {
    const row = decode({ c: "any", d: [1, 2], tt: 1789720859999 });

    expectTypeOf(row).toEqualTypeOf<Row<"bybit", "low_price" | "high_price">>();
    expect(row).toEqual({ ...BTC, time: 1789720800000, low_price: 1, high_price: 2 });
  });

  it("floors the tick time to the start of its minute, as history times its rows", () => {
    expect(decode({ c: "any", d: [1, 2], tt: 1789720860000 }).time).toBe(1789720860000);
    expect(decode({ c: "any", d: [1, 2], tt: 1789720919999 }).time).toBe(1789720860000);
  });

  it.each([{ d: [1], tt: 1 }, { d: [1, "2"], tt: 1 }, { d: [1, 2] }, { tt: 1 }, {}])(
    "refuses a frame the payload or the tick time does not fit, naming the channel: %j",
    (frame) => {
      expect(() => decode({ c: "any", ...frame } as never)).toThrow(VeloError);
      expect(() => decode({ c: "any", ...frame } as never)).toThrow(
        /unexpected realtime_bybit:BTCUSDT message/,
      );
    },
  );
});

describe("aggregatedDecoder", () => {
  const decode = aggregatedDecoder("realtime_BTC#Aggregated", EXCHANGES, "BTC", pair, columns);

  it("decodes a frame to one entry per exchange, with no time and no product", () => {
    const entries = decode({ c: "any", d: { realtime_bybit: [1, 2], realtime_deribit: [3, 4] } });

    expectTypeOf(entries).toEqualTypeOf<
      readonly ExchangeEntry<"bybit" | "deribit", "low_price" | "high_price">[]
    >();
    expect(entries).toEqual([
      { exchange: "bybit", coin: "BTC", low_price: 1, high_price: 2 },
      { exchange: "deribit", coin: "BTC", low_price: 3, high_price: 4 },
    ]);
  });

  it("skips an exchange the indicator does not list, and needs no tick time", () => {
    const entries = decode({
      c: "any",
      d: { realtime_bybit: [1, 2], "realtime_added-later": [9, 9] },
    });
    expect(entries.map((entry) => entry.exchange)).toEqual(["bybit"]);
    expect(decode({ c: "any", d: {} })).toEqual([]);
  });

  it.each([{ d: { realtime_bybit: [1] } }, { d: [1, 2] }, { d: 1 }, {}])(
    "refuses a frame whose payloads do not fit, naming the channel: %j",
    (frame) => {
      expect(() => decode({ c: "any", ...frame } as never)).toThrow(
        /unexpected realtime_BTC#Aggregated message/,
      );
    },
  );
});
