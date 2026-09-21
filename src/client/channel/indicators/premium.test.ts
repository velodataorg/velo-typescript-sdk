import { describe, expect, expectTypeOf, it } from "vitest";

import { VeloError } from "../../../errors.ts";
import { channel } from "../../../index.ts";
import type { FuturesPremiumColumn, FuturesPriceColumn } from "../../api/futures/selectors.ts";
import type { Row } from "../../data/row.ts";
import type { FuturesExchange } from "../../market/exchanges.ts";
import type { Channel } from "../channel.ts";
import type { ExchangeEntry } from "../helpers/decode.ts";
import type { Target } from "../helpers/target.ts";

const BTC = { exchange: "binance-futures", coin: "BTC", product: "BTCUSDT" } as const;
const SINGLE = "realtime_binance-futures:BTCUSDT#premium";
const AGGREGATE = "realtime_BTC#premium#Aggregated";
const WEIGHTED = "realtime_BTC#premium#weighted#Aggregated";

type PremiumColumn = FuturesPremiumColumn | FuturesPriceColumn<"open">;

/* Frames captured live on 2026-09-21 around the 08:48:00 UTC rollover. */
const LAST_OF_MINUTE = {
  c: SINGLE,
  d: [-13.659056635863207, 83657.3],
  f: false,
  tt: 1789980479999,
};
const ROLLOVER = {
  c: SINGLE,
  d: [-13.659056635863207, 83690.9],
  f: true,
  tt: 1789980480008,
};
/* Both captured at the same tick of that minute, 37 seconds in. */
const AGGREGATE_FRAME = {
  c: AGGREGATE,
  tt: 1789980457476,
  f: false,
  d: {
    realtime_hyperliquid: [53.57350427350718, 83757],
    realtime_bybit: [-18.023929961090037, 83667.3],
    "realtime_binance-futures": [-6.638582121667342, 83657.3],
    "realtime_okex-swap": [-31.934974093264422, 83650],
    "realtime_okex-coin-margin": [-34.189506172839934, 83636.3],
    "realtime_binance-coin-margin": [-36.12268811935534, 83619.3],
    "realtime_bybit-coin-margin": [-32.73532374100567, 83640.3],
    realtime_deribit: [52.71811764706029, 83703.5],
  },
};
const WEIGHTED_FRAME = {
  c: WEIGHTED,
  tt: 1789980457476,
  f: false,
  d: {
    realtime_hyperliquid: [53.57350427350718, 83757, 44454.26268],
    realtime_bybit: [-18.023929961090037, 83667.3, 56148.607],
    "realtime_binance-futures": [-6.638582121667342, 83657.3, 109748.662],
    "realtime_okex-swap": [-31.934974093264422, 83650, 29684.075200000105],
    "realtime_okex-coin-margin": [-34.189506172839934, 83636.3, 5930.304067804726],
    "realtime_binance-coin-margin": [-36.12268811935534, 83619.3, 14533.028025883305],
    "realtime_bybit-coin-margin": [-32.73532374100567, 83640.3, 5670.7853071253485],
    realtime_deribit: [52.71811764706029, 83703.5, 9334.988226507809],
  },
};

describe("channel.premium", () => {
  it("names one channel per target, and the weighted one for a coin", () => {
    const named = (built: { readonly kind: string; readonly name: string }) => [
      built.kind,
      built.name,
    ];

    expect(named(channel.premium(BTC))).toEqual(["premium", SINGLE]);
    expect(named(channel.premium({ coin: "BTC" }))).toEqual(["aggregated_premium", AGGREGATE]);
    expect(named(channel.premium({ coin: "BTC" }, { weighted: true }))).toEqual([
      "aggregated_premium_weighted",
      WEIGHTED,
    ]);
  });

  it("types each channel in history's columns, the weight among them when weighted", () => {
    expectTypeOf(channel.premium(BTC)).toEqualTypeOf<
      Channel<"premium", Row<FuturesExchange, PremiumColumn>>
    >();
    expectTypeOf(channel.premium({ coin: "BTC" })).toEqualTypeOf<
      Channel<"aggregated_premium", readonly ExchangeEntry<FuturesExchange, PremiumColumn>[]>
    >();
    expectTypeOf(channel.premium({ coin: "BTC" }, { weighted: true })).toEqualTypeOf<
      Channel<
        "aggregated_premium_weighted",
        readonly ExchangeEntry<FuturesExchange, PremiumColumn | "coin_open_interest_close">[]
      >
    >();
  });

  it("decodes a frame to the history row of its minute; the next opens at the premium it left", () => {
    /* These are the values /api/v1/rows returned for the same minute. */
    expect(channel.premium(BTC).decode(LAST_OF_MINUTE)).toEqual({
      exchange: "binance-futures",
      coin: "BTC",
      product: "BTCUSDT",
      time: 1789980420000,
      premium: -13.659056635863207,
      open_price: 83657.3,
    });
    expect(channel.premium(BTC).decode(ROLLOVER)).toEqual({
      exchange: "binance-futures",
      coin: "BTC",
      product: "BTCUSDT",
      time: 1789980480000,
      premium: -13.659056635863207,
      open_price: 83690.9,
    });
  });

  it("decodes a coin's frame to one entry per exchange, in the product columns, without a time", () => {
    const entries = channel.premium({ coin: "BTC" }).decode(AGGREGATE_FRAME);

    expect(entries).toHaveLength(8);
    expect(entries.find((entry) => entry.exchange === "deribit")).toEqual({
      exchange: "deribit",
      coin: "BTC",
      premium: 52.71811764706029,
      open_price: 83703.5,
    });
  });

  it("decodes a weighted frame to each exchange's premium beside its weight", () => {
    const entries = channel.premium({ coin: "BTC" }, { weighted: true }).decode(WEIGHTED_FRAME);

    expect(entries.find((entry) => entry.exchange === "binance-futures")).toEqual({
      exchange: "binance-futures",
      coin: "BTC",
      premium: -6.638582121667342,
      open_price: 83657.3,
      coin_open_interest_close: 109748.662,
    });
    /* The server sends the weights, not the average; this is how a caller gets it. */
    const weight = entries.reduce((sum, entry) => sum + (entry.coin_open_interest_close ?? 0), 0);
    const average =
      entries.reduce(
        (sum, entry) => sum + (entry.premium ?? 0) * (entry.coin_open_interest_close ?? 0),
        0,
      ) / weight;
    expect(average).toBeCloseTo(-2.6432281005, 8);
  });

  it("checks each channel's own payload, so a neighbour's frame is refused", () => {
    expect(() => channel.premium({ coin: "BTC" }).decode(WEIGHTED_FRAME)).toThrow(VeloError);
    expect(() =>
      channel.premium({ coin: "BTC" }, { weighted: true }).decode(AGGREGATE_FRAME),
    ).toThrow(VeloError);
  });

  it("refuses weighted for a product, at compile time too", () => {
    const refusal = 'channel.premium() weights only the premium of a coin, such as { coin: "BTC" }';

    // @ts-expect-error weighted is published for a coin only
    expect(() => channel.premium(BTC, { weighted: true })).toThrow(refusal);

    /* A target that may be a product is refused as a product is, not let through as a coin. */
    const either = BTC as Target<FuturesExchange>;
    // @ts-expect-error weighted needs a target known to be a coin
    expect(() => channel.premium(either, { weighted: true })).toThrow(refusal);

    /* Switching it off is always allowed. */
    expect(channel.premium(BTC, { weighted: false }).kind).toBe("premium");
  });

  it("widens to each channel it may be when weighted is not known until it runs", () => {
    const build = (weighted: boolean) => channel.premium({ coin: "BTC" }, { weighted });
    expectTypeOf(build(true).kind).toEqualTypeOf<
      "aggregated_premium" | "aggregated_premium_weighted"
    >();
    expect(build(true).kind).toBe("aggregated_premium_weighted");
    expect(build(false).kind).toBe("aggregated_premium");
  });

  it("follows futures products only", () => {
    // @ts-expect-error a spot exchange publishes no premium
    expect(() => channel.premium({ ...BTC, exchange: "binance" })).toThrow(
      'channel.premium() received an invalid exchange "binance"',
    );
  });
});
