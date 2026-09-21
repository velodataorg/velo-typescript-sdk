import { describe, expect, expectTypeOf, it } from "vitest";

import { VeloError } from "../../../errors.ts";
import type { Row } from "../../data/row.ts";
import { aggregatedDecoder, singleDecoder } from "./decode.ts";
import type { ColumnOf, ExchangeEntry } from "./decode.ts";

const BTC = { exchange: "bybit", coin: "BTC", product: "BTCUSDT" } as const;
const EXCHANGES = ["bybit", "deribit"] as const;
const NAME = "realtime_bybit:BTCUSDT";

describe("singleDecoder", () => {
  const decode = singleDecoder(NAME, BTC, ["low_price", "high_price"]);

  it("decodes a frame to a history row: the product, its minute, then the columns by position", () => {
    const row = decode({ c: "any", d: [1, 2], tt: 1789720859999 });

    expectTypeOf(row).toEqualTypeOf<Row<"bybit", "low_price" | "high_price">>();
    expect(row).toEqual({ ...BTC, time: 1789720800000, low_price: 1, high_price: 2 });
  });

  it("floors the tick time to the start of its minute, as history times its rows", () => {
    expect(decode({ c: "any", d: [1, 2], tt: 1789720860000 }).time).toBe(1789720860000);
    expect(decode({ c: "any", d: [1, 2], tt: 1789720919999 }).time).toBe(1789720860000);
  });

  it("reads a single name as a bare number", () => {
    const bare = singleDecoder(NAME, BTC, "premium");
    const row = bare({ c: "any", d: 0.5, tt: 60_000 });

    expectTypeOf(row).toEqualTypeOf<Row<"bybit", "premium">>();
    expect(row).toEqual({ ...BTC, time: 60_000, premium: 0.5 });
    /* A list of one name is a tuple of one, which a bare number is not. */
    expect(() => bare({ c: "any", d: [0.5], tt: 60_000 })).toThrow(VeloError);
    expect(() => singleDecoder(NAME, BTC, ["premium"])({ c: "any", d: 0.5, tt: 1 })).toThrow(
      VeloError,
    );
  });

  it("leaves out a position named null, and still requires it in the frame", () => {
    const skipping = singleDecoder(NAME, BTC, ["premium", null, "close_price"]);
    const row = skipping({ c: "any", d: [0.5, 9, 3], tt: 60_000 });

    expectTypeOf(row).toEqualTypeOf<Row<"bybit", "premium" | "close_price">>();
    expect(row).toEqual({ ...BTC, time: 60_000, premium: 0.5, close_price: 3 });
    expect(() => skipping({ c: "any", d: [0.5, 3], tt: 60_000 })).toThrow(VeloError);
  });

  it.each([
    { d: [1], tt: 1 },
    { d: [1, 2, 3], tt: 1 },
    { d: [1, "2"], tt: 1 },
    { d: [1, null], tt: 1 },
    { d: [1, 2] },
    { tt: 1 },
    {},
  ])(
    "refuses a frame whose payload does not fit the names, or that has no tick time: %j",
    (frame) => {
      expect(() => decode({ c: "any", ...frame } as never)).toThrow(VeloError);
      expect(() => decode({ c: "any", ...frame } as never)).toThrow(
        /unexpected realtime_bybit:BTCUSDT message/,
      );
    },
  );

  it("refuses columns that name no position", () => {
    expect(() => singleDecoder(NAME, BTC, [])).toThrow(
      "a channel's columns must name at least one position",
    );
  });

  it("takes only names history has, or the few a channel alone fills", () => {
    // @ts-expect-error not a column
    expect(singleDecoder(NAME, BTC, "premuim")).toBeTypeOf("function");
    expectTypeOf<ColumnOf<"coin_funding_spend_rate">>().toEqualTypeOf<"coin_funding_spend_rate">();
    expectTypeOf<ColumnOf<readonly ["premium", null, "close_price"]>>().toEqualTypeOf<
      "premium" | "close_price"
    >();
  });
});

describe("aggregatedDecoder", () => {
  const decode = aggregatedDecoder("realtime_BTC#Aggregated", EXCHANGES, "BTC", [
    "low_price",
    "high_price",
  ]);

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
