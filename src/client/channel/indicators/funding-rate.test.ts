import { describe, expect, expectTypeOf, it } from "vitest";

import { channel, channels, Velo, VeloError } from "../../../index.ts";
import { FakeSocket, flushConnection } from "../../../transport/fake-socket.ts";
import type { FutureProduct } from "../../api/catalog/futures.ts";
import type { Row } from "../../data/row.ts";
import type { FuturesExchange } from "../../market/exchanges.ts";
import type { Channel } from "../channel.ts";
import type { ExchangeEntry } from "../helpers/decode.ts";

const BTC = { exchange: "binance-futures", coin: "BTC", product: "BTCUSDT" } as const;
const RATE = "realtime_binance-futures:BTCUSDT#funding_rate#Rate (%)";
const AGGREGATE_RATE = "realtime_BTC#funding_rate#Rate (%)#Aggregated";
const WEIGHTED_RATE = "realtime_BTC#funding_rate#Rate (%)#weighted#Aggregated";

/* Frames captured live on 2026-09-18 inside the 13:28 UTC minute. */
const RATE_FRAME = { c: RATE, d: 0.00003256, f: false, tt: 1789738123404 };
const COIN_FRAME = {
  c: "realtime_binance-futures:BTCUSDT#funding_rate#Total Spend Rate (Coins)",
  d: 3.50862542096,
  f: false,
  tt: 1789738117000,
};
/* The server leaves `f` off this channel's frames. */
const DOLLAR_FRAME = {
  c: "realtime_binance-futures:BTCUSDT#funding_rate#Total Spend Rate ($)",
  d: 274058.3807686435,
  tt: 1789738116554,
};
const AGGREGATE_RATE_FRAME = {
  c: AGGREGATE_RATE,
  f: false,
  tt: 1789738116842,
  d: {
    realtime_deribit: 0.0000325,
    realtime_hyperliquid: 0.0001,
    "realtime_binance-futures": 0.00003256,
    realtime_bybit: 0.00009581,
    "realtime_bybit-coin-margin": 0.00007158,
    "realtime_okex-swap": 0.0000645467347242,
    "realtime_okex-coin-margin": 0.0001,
    "realtime_binance-coin-margin": 0.0001,
  },
};
const WEIGHTED_RATE_FRAME = {
  c: WEIGHTED_RATE,
  f: false,
  tt: 1789738116842,
  d: {
    realtime_deribit: [0.0000325, 9993.086300221625],
    realtime_hyperliquid: [0.0001, 38694.08518],
    "realtime_binance-futures": [0.00003256, 107759.434],
    realtime_bybit: [0.00009581, 56804.13],
    "realtime_bybit-coin-margin": [0.00007158, 5944.099771097833],
    "realtime_okex-swap": [0.0000645467347242, 28741.31830000017],
    "realtime_okex-coin-margin": [0.0001, 6568.354097839652],
    "realtime_binance-coin-margin": [0.0001, 16061.082201101754],
  },
};

describe("channel.fundingRate", () => {
  it("renders the target and the options into the channel string, defaults included", () => {
    expect(channel.fundingRate(BTC).name).toBe(RATE);
    expect(channel.fundingRate(BTC, {}).name).toBe(RATE);
    expect(channel.fundingRate(BTC, { measure: "rate", weighted: false }).name).toBe(RATE);
    expect(channel.fundingRate(BTC, { measure: "coins" }).name).toBe(COIN_FRAME.c);
    expect(channel.fundingRate(BTC, { measure: "dollars" }).name).toBe(DOLLAR_FRAME.c);

    expect(channel.fundingRate({ coin: "BTC" }).name).toBe(AGGREGATE_RATE);
    expect(channel.fundingRate({ coin: "BTC" }, { measure: "coins" }).name).toBe(
      "realtime_BTC#funding_rate#Total Spend Rate (Coins)#Aggregated",
    );
    expect(channel.fundingRate({ coin: "BTC" }, { measure: "dollars" }).name).toBe(
      "realtime_BTC#funding_rate#Total Spend Rate ($)#Aggregated",
    );
    expect(channel.fundingRate({ coin: "BTC" }, { weighted: true }).name).toBe(WEIGHTED_RATE);
  });

  it("types the channel from the target and the options", () => {
    expectTypeOf(channel.fundingRate(BTC)).toEqualTypeOf<
      Channel<"funding_rate", Row<FuturesExchange, "funding_rate">>
    >();
    expectTypeOf(channel.fundingRate(BTC, {})).toEqualTypeOf<
      Channel<"funding_rate", Row<FuturesExchange, "funding_rate">>
    >();
    expectTypeOf(channel.fundingRate(BTC, { measure: "dollars" })).toEqualTypeOf<
      Channel<"funding_spend_rate_dollars", Row<FuturesExchange, "dollar_funding_spend_rate">>
    >();
    expectTypeOf(channel.fundingRate({ coin: "BTC" })).toEqualTypeOf<
      Channel<"aggregated_funding_rate", readonly ExchangeEntry<FuturesExchange, "funding_rate">[]>
    >();
    expectTypeOf(channel.fundingRate({ coin: "BTC" }, { measure: "coins" })).toEqualTypeOf<
      Channel<
        "aggregated_funding_spend_rate_coins",
        readonly ExchangeEntry<FuturesExchange, "coin_funding_spend_rate">[]
      >
    >();
    expectTypeOf(channel.fundingRate({ coin: "BTC" }, { weighted: true })).toEqualTypeOf<
      Channel<
        "aggregated_funding_rate_weighted",
        readonly ExchangeEntry<FuturesExchange, "funding_rate" | "coin_open_interest_close">[]
      >
    >();
  });

  it("builds frozen channels of three fields whose kind matches their type", () => {
    const built = [
      [channel.fundingRate(BTC), "funding_rate"],
      [channel.fundingRate(BTC, { measure: "coins" }), "funding_spend_rate_coins"],
      [channel.fundingRate(BTC, { measure: "dollars" }), "funding_spend_rate_dollars"],
      [channel.fundingRate({ coin: "BTC" }), "aggregated_funding_rate"],
      [
        channel.fundingRate({ coin: "BTC" }, { measure: "coins" }),
        "aggregated_funding_spend_rate_coins",
      ],
      [
        channel.fundingRate({ coin: "BTC" }, { measure: "dollars" }),
        "aggregated_funding_spend_rate_dollars",
      ],
      [
        channel.fundingRate({ coin: "BTC" }, { weighted: true }),
        "aggregated_funding_rate_weighted",
      ],
    ] as const;
    for (const [one, kind] of built) {
      expect(one.kind).toBe(kind);
      expect(Object.keys(one).sort()).toEqual(["decode", "kind", "name"]);
      expect(Object.isFrozen(one)).toBe(true);
    }
  });

  it("decodes a product's frame to a row timed at its minute, in the measure's column", () => {
    /* /api/v1/rows returned funding_rate 0.00003256 for the same minute. */
    expect(channel.fundingRate(BTC).decode(RATE_FRAME)).toEqual({
      ...BTC,
      time: 1789738080000,
      funding_rate: 0.00003256,
    });
    expect(channel.fundingRate(BTC, { measure: "coins" }).decode(COIN_FRAME)).toEqual({
      ...BTC,
      time: 1789738080000,
      coin_funding_spend_rate: 3.50862542096,
    });
    expect(channel.fundingRate(BTC, { measure: "dollars" }).decode(DOLLAR_FRAME)).toEqual({
      ...BTC,
      time: 1789738080000,
      dollar_funding_spend_rate: 274058.3807686435,
    });
  });

  it("accepts catalog products as returned", () => {
    const listed: FutureProduct = { ...BTC, begin: 0, depth: true };
    expect(channel.fundingRate(listed).decode(RATE_FRAME)).toMatchObject(BTC);
  });

  it("decodes a coin's frame to one entry per exchange, without a time", () => {
    const entries = channel.fundingRate({ coin: "BTC" }).decode(AGGREGATE_RATE_FRAME);

    expect(entries).toHaveLength(8);
    expect(entries.find((entry) => entry.exchange === "binance-futures")).toEqual({
      exchange: "binance-futures",
      coin: "BTC",
      funding_rate: 0.00003256,
    });
  });

  it("decodes a weighted frame to each exchange's rate beside its weight", () => {
    const weighted = channel.fundingRate({ coin: "BTC" }, { weighted: true });
    const entries = weighted.decode(WEIGHTED_RATE_FRAME);

    expect(entries.find((entry) => entry.exchange === "binance-futures")).toEqual({
      exchange: "binance-futures",
      coin: "BTC",
      funding_rate: 0.00003256,
      coin_open_interest_close: 107759.434,
    });
    /* The server sends the weights, not the average; this is how a caller gets it. */
    const weight = entries.reduce((sum, entry) => sum + (entry.coin_open_interest_close ?? 0), 0);
    const average =
      entries.reduce(
        (sum, entry) => sum + (entry.funding_rate ?? 0) * (entry.coin_open_interest_close ?? 0),
        0,
      ) / weight;
    expect(average).toBeCloseTo(0.0000653772, 10);
  });

  it("checks each channel's own payload, so a neighbour's frame is refused", () => {
    const rate = channel.fundingRate({ coin: "BTC" });
    const weighted = channel.fundingRate({ coin: "BTC" }, { weighted: true });

    expect(() => rate.decode(WEIGHTED_RATE_FRAME)).toThrow(VeloError);
    expect(() => weighted.decode(AGGREGATE_RATE_FRAME)).toThrow(VeloError);
    expect(() => rate.decode(RATE_FRAME)).toThrow(
      /unexpected realtime_BTC#funding_rate#Rate \(%\)#Aggregated/,
    );
  });

  it.each([
    { ...RATE_FRAME, d: "0.0001" },
    { ...RATE_FRAME, d: [0.0001] },
    { ...RATE_FRAME, d: null },
    { ...RATE_FRAME, tt: undefined },
    { c: RATE },
  ])("rejects a malformed frame: %j", (frame) => {
    expect(() => channel.fundingRate(BTC).decode(frame as never)).toThrow(VeloError);
    expect(() => channel.fundingRate(BTC).decode(frame as never)).toThrow(
      /unexpected realtime_binance-futures:BTCUSDT#funding_rate/,
    );
  });

  it("refuses a combination the server does not publish, at compile time too", () => {
    const refusal =
      'channel.fundingRate() weights only the rate of a coin, such as { coin: "BTC" }';

    // @ts-expect-error weighted is published for a coin only
    expect(() => channel.fundingRate(BTC, { weighted: true })).toThrow(refusal);
    expect(() =>
      // @ts-expect-error only the rate is weighted
      channel.fundingRate({ coin: "BTC" }, { measure: "coins", weighted: true }),
    ).toThrow(refusal);
    expect(() =>
      // @ts-expect-error only the rate is weighted
      channel.fundingRate({ coin: "BTC" }, { measure: "dollars", weighted: true }),
    ).toThrow(refusal);

    /* Switching it off is always allowed. */
    expect(channel.fundingRate(BTC, { weighted: false }).kind).toBe("funding_rate");
    expect(channel.fundingRate({ coin: "BTC" }, { measure: "coins", weighted: false }).kind).toBe(
      "aggregated_funding_spend_rate_coins",
    );
  });

  it("widens to each channel it may be when an option is not known until it runs", () => {
    const build = (weighted: boolean) => channel.fundingRate({ coin: "BTC" }, { weighted });
    expectTypeOf(build(true).kind).toEqualTypeOf<
      "aggregated_funding_rate" | "aggregated_funding_rate_weighted"
    >();
    expect(build(true).kind).toBe("aggregated_funding_rate_weighted");
    expect(build(false).kind).toBe("aggregated_funding_rate");
  });

  it.each([
    { measure: "Rate (%)" },
    { measure: "coin" },
    { measure: true },
    { weighted: "true" },
    { weighted: 1 },
    { aggregated: true },
    { metric: "coins" },
    [],
    null,
    "rate",
  ])("rejects options it cannot read: %j", (options) => {
    const untyped = channel.fundingRate as (target: unknown, options: unknown) => unknown;
    expect(() => untyped(BTC, options)).toThrow(VeloError);
  });

  it("names what a caller may choose when a choice is unknown", () => {
    const untyped = channel.fundingRate as (target: unknown, options: unknown) => unknown;
    expect(() => untyped(BTC, { measure: "spend" })).toThrow(
      'channel.fundingRate() received an unknown measure "spend"; expected rate, coins, dollars',
    );
    expect(() => untyped(BTC, { weighted: "yes" })).toThrow(
      'channel.fundingRate() takes a boolean for weighted (got "yes")',
    );
    expect(() => untyped(BTC, { metric: "coins" })).toThrow(
      'channel.fundingRate() received an unknown option "metric"; expected measure, weighted',
    );
  });

  it.each([null, "BTC", { ...BTC, exchange: "binance" }, { ...BTC, product: "" }, { coin: "" }])(
    "accepts only a futures product or a coin: %j",
    (target) => {
      expect(() => channel.fundingRate(target as never)).toThrow(VeloError);
    },
  );

  it("builds channels that can be passed around unbound", () => {
    const products = [BTC, { exchange: "bybit", coin: "BTC", product: "BTCUSDT" } as const];
    expect(products.map((product) => channel.fundingRate(product).name)).toEqual([
      RATE,
      "realtime_bybit:BTCUSDT#funding_rate#Rate (%)",
    ]);
  });

  it("rides a feed beside its weighted form, narrowed apart by kind", async () => {
    const sockets: FakeSocket[] = [];
    const client = new Velo({
      apiKey: "key",
      webSocketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    });
    const seen: [string, number | null][] = [];
    const feed = channels.feed([
      channel.fundingRate(BTC),
      channel.fundingRate({ coin: "BTC" }, { weighted: true }),
    ]);
    const pending = client.watch(feed, {
      on: {
        data: (event) => {
          expectTypeOf(event.kind).toEqualTypeOf<
            "funding_rate" | "aggregated_funding_rate_weighted"
          >();
          if (event.kind === "funding_rate") {
            expectTypeOf(event.data).toEqualTypeOf<Row<FuturesExchange, "funding_rate">>();
            seen.push([event.kind, event.data.funding_rate]);
          } else {
            seen.push([event.kind, event.data[0]?.coin_open_interest_close ?? null]);
          }
        },
      },
    });
    await flushConnection();
    sockets[0]!.open();
    const watcher = await pending;

    sockets[0]!.message(JSON.stringify(RATE_FRAME));
    sockets[0]!.message(JSON.stringify(WEIGHTED_RATE_FRAME));

    expect(sockets[0]!.sent).toEqual([`s2 ${RATE}`, `s2 ${WEIGHTED_RATE}`]);
    expect(seen).toEqual([
      ["funding_rate", 0.00003256],
      ["aggregated_funding_rate_weighted", 9993.086300221625],
    ]);
    watcher.close();
  });
});
