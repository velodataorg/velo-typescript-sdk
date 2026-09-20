import { describe, expect, expectTypeOf, it } from "vitest";

import { VeloError } from "../../../errors.ts";
import type { Row } from "../../data/row.ts";
import type { Channel } from "../channel.ts";
import { aggregatedChannel, buildChannel, singleChannel } from "./build.ts";
import type { ChannelFor } from "./build.ts";
import type { ExchangeEntry } from "./decode.ts";
import type { Coin } from "./target.ts";

const BTC = { exchange: "bybit", coin: "BTC", product: "BTCUSDT" } as const;
const EXCHANGES = ["bybit", "deribit"] as const;
const PREMIUM = { suffix: "#premium", kind: "premium", columns: "premium" } as const;
const WEIGHTED_PREMIUM = {
  suffix: "#premium#weighted",
  kind: "premium_weighted",
  columns: ["premium", null, "coin_open_interest_close"],
} as const;

describe("singleChannel", () => {
  it("renders the name, keeps the kind, and decodes rows, frozen", () => {
    const built = singleChannel(BTC, PREMIUM);

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
    const built = aggregatedChannel("BTC", EXCHANGES, PREMIUM);

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

  it("takes a definition that may be either of two, in one call", () => {
    const build = (weighted: boolean) =>
      aggregatedChannel("BTC", EXCHANGES, weighted ? WEIGHTED_PREMIUM : PREMIUM);

    expect(build(true).name).toBe("realtime_BTC#premium#weighted#Aggregated");
    expect(build(true).decode({ c: "any", d: { realtime_bybit: [0.5, 9, 3] } })).toEqual([
      { exchange: "bybit", coin: "BTC", premium: 0.5, coin_open_interest_close: 3 },
    ]);
    expect(build(false).name).toBe("realtime_BTC#premium#Aggregated");
  });

  it("refuses a name that cannot be rendered", () => {
    expect(() => aggregatedChannel("", EXCHANGES, PREMIUM)).toThrow(VeloError);
    expect(() => aggregatedChannel("BTC", EXCHANGES, { ...PREMIUM, suffix: "premium" })).toThrow(
      VeloError,
    );
  });
});

describe("buildChannel", () => {
  it("builds the single channel for a parsed product and the aggregated one for a parsed coin", () => {
    const single = buildChannel({ scope: "single", product: BTC }, EXCHANGES, PREMIUM);
    const aggregated = buildChannel({ scope: "aggregated", coin: "BTC" }, EXCHANGES, PREMIUM);

    expect([single.kind, single.name]).toEqual(["premium", "realtime_bybit:BTCUSDT#premium"]);
    expect([aggregated.kind, aggregated.name]).toEqual([
      "aggregated_premium",
      "realtime_BTC#premium#Aggregated",
    ]);
    /* The exchanges reach the aggregated decoder, which skips one it does not list. */
    expect(
      aggregated.decode({ c: "any", d: { realtime_deribit: 0.5, "realtime_added-later": 9 } }),
    ).toEqual([{ exchange: "deribit", coin: "BTC", premium: 0.5 }]);
  });

  it("returns a plain channel, leaving its type to the indicator that knows its target", () => {
    const built = buildChannel({ scope: "single", product: BTC }, EXCHANGES, PREMIUM);
    expectTypeOf(built).toEqualTypeOf<Channel>();
  });
});

describe("ChannelFor", () => {
  it("is the single channel for a product and the aggregated one for a coin", () => {
    expectTypeOf<ChannelFor<typeof BTC, "bybit", typeof PREMIUM>>().toEqualTypeOf<
      Channel<"premium", Row<"bybit", "premium">>
    >();
    expectTypeOf<ChannelFor<Coin, "bybit", typeof WEIGHTED_PREMIUM>>().toEqualTypeOf<
      Channel<
        "aggregated_premium_weighted",
        readonly ExchangeEntry<"bybit", "premium" | "coin_open_interest_close">[]
      >
    >();
  });

  it("keeps each definition's own columns when it may be either of two", () => {
    /* One channel per definition, never one channel with only the columns they share. */
    expectTypeOf<
      ChannelFor<Coin, "bybit", typeof PREMIUM | typeof WEIGHTED_PREMIUM>
    >().toEqualTypeOf<
      | Channel<"aggregated_premium", readonly ExchangeEntry<"bybit", "premium">[]>
      | Channel<
          "aggregated_premium_weighted",
          readonly ExchangeEntry<"bybit", "premium" | "coin_open_interest_close">[]
        >
    >();
  });
});
