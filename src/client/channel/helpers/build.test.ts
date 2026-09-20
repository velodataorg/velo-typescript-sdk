import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import { VeloError } from "../../../errors.ts";
import type { Row } from "../../data/row.ts";
import type { Channel } from "../channel.ts";
import { aggregatedChannel, singleChannel } from "./build.ts";
import type { ChannelFor } from "./build.ts";
import type { ExchangeEntry } from "./decode.ts";
import type { Coin } from "./target.ts";

const BTC = { exchange: "bybit", coin: "BTC", product: "BTCUSDT" } as const;
const EXCHANGES = ["bybit", "deribit"] as const;
const premium = (value: number) => ({ premium: value });

describe("singleChannel", () => {
  it("renders the name, keeps the kind, and decodes rows, frozen", () => {
    const built = singleChannel(BTC, {
      words: ["premium"],
      kind: "premium",
      payload: z.number(),
      columns: premium,
    });

    expectTypeOf(built).toEqualTypeOf<Channel<"premium", Row<"bybit", "premium">>>();
    expect([built.kind, built.name]).toEqual(["premium", "realtime_bybit:BTCUSDT#premium"]);
    expect(built.decode({ c: built.name, d: 0.5, tt: 60_000 })).toEqual({
      ...BTC,
      time: 60_000,
      premium: 0.5,
    });
    expect(Object.keys(built).sort()).toEqual(["decode", "kind", "name"]);
    expect(Object.isFrozen(built)).toBe(true);
  });
});

describe("aggregatedChannel", () => {
  it("renders the aggregated name and prefixes the kind, in the type as in the value", () => {
    const built = aggregatedChannel("BTC", EXCHANGES, {
      words: ["premium"],
      kind: "premium",
      payload: z.number(),
      columns: premium,
    });

    expectTypeOf(built).toEqualTypeOf<
      Channel<"aggregated_premium", readonly ExchangeEntry<"bybit" | "deribit", "premium">[]>
    >();
    expect([built.kind, built.name]).toEqual([
      "aggregated_premium",
      "realtime_BTC#premium#Aggregated",
    ]);
    expect(built.decode({ c: built.name, d: { realtime_deribit: 0.5 } })).toEqual([
      { exchange: "deribit", coin: "BTC", premium: 0.5 },
    ]);
    expect(Object.isFrozen(built)).toBe(true);
  });

  it("refuses a name that cannot be rendered", () => {
    const definition = { kind: "premium", payload: z.number(), columns: premium };
    expect(() => aggregatedChannel("", EXCHANGES, { ...definition, words: [] })).toThrow(VeloError);
    expect(() => aggregatedChannel("BTC", EXCHANGES, { ...definition, words: ["a#b"] })).toThrow(
      VeloError,
    );
  });
});

describe("ChannelFor", () => {
  const plain = {
    words: ["premium"],
    kind: "premium",
    payload: z.number(),
    columns: premium,
  } as const;
  const weighted = {
    words: ["premium", "weighted"],
    kind: "premium_weighted",
    payload: z.tuple([z.number(), z.number()]),
    columns: ([value, weight]: [number, number]) => ({ premium: value, weight }),
  } as const;

  it("is the single channel for a product and the aggregated one for a coin", () => {
    expectTypeOf<ChannelFor<typeof BTC, "bybit", typeof plain>>().toEqualTypeOf<
      Channel<"premium", Row<"bybit", "premium">>
    >();
    expectTypeOf<ChannelFor<Coin, "bybit", typeof weighted>>().toEqualTypeOf<
      Channel<
        "aggregated_premium_weighted",
        readonly ExchangeEntry<"bybit", "premium" | "weight">[]
      >
    >();
  });

  it("keeps each definition's own columns when it may be either of two", () => {
    /* One channel per definition, never one channel with only the columns they share. */
    expectTypeOf<ChannelFor<Coin, "bybit", typeof plain | typeof weighted>>().toEqualTypeOf<
      | Channel<"aggregated_premium", readonly ExchangeEntry<"bybit", "premium">[]>
      | Channel<
          "aggregated_premium_weighted",
          readonly ExchangeEntry<"bybit", "premium" | "weight">[]
        >
    >();
  });
});
