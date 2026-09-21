import { describe, expect, it } from "vitest";

import { channel } from "../../index.ts";
import type { Channel } from "./channel.ts";

/*
 * What the server publishes, copied from `channel-info.js` in velo-websockets
 * as of its commit 5455502 (2025-12-10). The server joins each list to its
 * targets: `realtime_<exchange>:<product>` for a product and `realtime_<coin>`
 * for a coin, then the suffix. Copy the lists again whenever the server's do.
 *
 * An indicator's own test says what its author believes a channel is called.
 * This is the only place that belief meets what the server calls it.
 */
const SERVER = {
  futuresProduct: [
    "",
    "#open_interest#Coins",
    "#open_interest#Dollars",
    "#funding_rate#Rate (%)",
    "#funding_rate#Total Spend Rate (Coins)",
    "#funding_rate#Total Spend Rate ($)",
    "#liquidations#Coins",
    "#liquidations#Liquidation Count",
    "#liquidations#Dollars",
    "#tape#Trade Count",
    "#volume#Coins",
    "#volume#Dollars",
    "#vwap",
    "#turnover",
    "#oiwap",
    "#returns",
    "#premium",
    "#total_return",
  ],
  spotProduct: ["", "#spotvol#Coins", "#spotvol#Dollars", "#spottape#Trade Count"],
  futuresCoin: [
    "#open_interest#Coins#Aggregated",
    "#open_interest#Dollars#Aggregated",
    "#volume#Coins#Aggregated",
    "#volume#Dollars#Aggregated",
    "#tape#Trade Count#Aggregated",
    "#funding_rate#Rate (%)#Aggregated",
    "#funding_rate#Total Spend Rate (Coins)#Aggregated",
    "#funding_rate#Total Spend Rate ($)#Aggregated",
    "#funding_rate#Rate (%)#weighted#Aggregated",
    "#liquidations#Coins#Aggregated",
    "#liquidations#Liquidation Count#Aggregated",
    "#liquidations#Dollars#Aggregated",
    "#premium#Aggregated",
    "#premium#weighted#Aggregated",
  ],
  spotCoin: [
    "#spotvol#Coins#Aggregated",
    "#spotvol#Dollars#Aggregated",
    "#spottape#Trade Count#Aggregated",
  ],
} as const;

const PERP = { exchange: "binance-futures", coin: "BTC", product: "BTCUSDT" } as const;
const SPOT = { exchange: "coinbase", coin: "BTC", product: "BTC-USD" } as const;
const COIN = { coin: "BTC" } as const;

/*
 * Every channel the builders can build, one line each. The type makes a new
 * builder on `channel` a compile error here until it is listed; listing each
 * of its targets and options is by hand.
 */
const BUILT: Readonly<Record<Exclude<keyof typeof channel, "raw">, readonly Channel[]>> = {
  price: [channel.price(PERP), channel.price(SPOT)],
  openInterest: [
    channel.openInterest(PERP, { metric: "coins" }),
    channel.openInterest(PERP, { metric: "dollars" }),
    channel.openInterest(COIN, { metric: "coins" }),
    channel.openInterest(COIN, { metric: "dollars" }),
  ],
  fundingRate: [
    channel.fundingRate(PERP, { measure: "rate" }),
    channel.fundingRate(PERP, { measure: "coins" }),
    channel.fundingRate(PERP, { measure: "dollars" }),
    channel.fundingRate(COIN, { measure: "rate" }),
    channel.fundingRate(COIN, { measure: "coins" }),
    channel.fundingRate(COIN, { measure: "dollars" }),
    channel.fundingRate(COIN, { weighted: true }),
  ],
  volume: [
    channel.volume(PERP, { metric: "coins" }),
    channel.volume(PERP, { metric: "dollars" }),
    channel.volume(COIN, { metric: "coins" }),
    channel.volume(COIN, { metric: "dollars" }),
  ],
  tape: [channel.tape(PERP), channel.tape(COIN)],
  spotVolume: [
    channel.spotVolume(SPOT, { metric: "coins" }),
    channel.spotVolume(SPOT, { metric: "dollars" }),
    channel.spotVolume(COIN, { metric: "coins" }),
    channel.spotVolume(COIN, { metric: "dollars" }),
  ],
  spotTape: [channel.spotTape(SPOT), channel.spotTape(COIN)],
  premium: [
    channel.premium(PERP),
    channel.premium(COIN),
    channel.premium(COIN, { weighted: true }),
  ],
  liquidations: [channel.liquidations(PERP), channel.liquidations(COIN)],
  liquidationVolume: [
    channel.liquidationVolume(PERP, { metric: "coins" }),
    channel.liquidationVolume(PERP, { metric: "dollars" }),
    channel.liquidationVolume(COIN, { metric: "coins" }),
    channel.liquidationVolume(COIN, { metric: "dollars" }),
  ],
};

/* The names those lists make for the targets `BUILT` is built on, joined as the server joins them. */
const PUBLISHED = [
  ...SERVER.futuresProduct.map((suffix) => `realtime_${PERP.exchange}:${PERP.product}${suffix}`),
  ...SERVER.spotProduct.map((suffix) => `realtime_${SPOT.exchange}:${SPOT.product}${suffix}`),
  ...SERVER.futuresCoin.map((suffix) => `realtime_${COIN.coin}${suffix}`),
  ...SERVER.spotCoin.map((suffix) => `realtime_${COIN.coin}${suffix}`),
];

/*
 * What the server publishes and no builder builds, on purpose. Each of these
 * is named after an indicator and carries only what the web app computes it
 * from, over a window its user picks: `#vwap` is `coin_volume` and
 * `dollar_volume`, `#returns` is `close_price`, `#total_return` is
 * `close_price` and `funding_rate`, `#oiwap` is both open interest closes.
 * `channel.price`, `channel.fundingRate`, and `channel.openInterest` already
 * carry those columns. Nothing publishes `#turnover`. A new suffix on the
 * server shows up here as a failure until it has a builder or a line.
 */
const NOT_BUILT = [
  "realtime_binance-futures:BTCUSDT#vwap",
  "realtime_binance-futures:BTCUSDT#turnover",
  "realtime_binance-futures:BTCUSDT#oiwap",
  "realtime_binance-futures:BTCUSDT#returns",
  "realtime_binance-futures:BTCUSDT#total_return",
];

const ALL = Object.entries(BUILT).flatMap(([builder, built]) =>
  built.map(({ kind, name }) => ({ builder, kind, name })),
);

describe("the channels the server publishes", () => {
  it.each(ALL)("$builder builds a name the server publishes: $name", ({ name }) => {
    expect(PUBLISHED).toContain(name);
  });

  it("builds everything the server publishes but what is left out on purpose", () => {
    const built = new Set(ALL.map((row) => row.name));
    expect(PUBLISHED.filter((name) => !built.has(name))).toEqual(NOT_BUILT);
  });

  it("gives every channel its own kind, so a listener can narrow on it", () => {
    const suffixesOfKind = new Map<string, Set<string>>();
    const kindsOfSuffix = new Map<string, Set<string>>();
    for (const { kind, name } of ALL) {
      /* What follows the target, which holds no `#`. */
      const suffix = name.includes("#") ? name.slice(name.indexOf("#")) : "";
      suffixesOfKind.set(kind, (suffixesOfKind.get(kind) ?? new Set()).add(suffix));
      kindsOfSuffix.set(suffix, (kindsOfSuffix.get(suffix) ?? new Set()).add(kind));
    }
    /* Price is one kind on futures and on spot: the same suffix, so the same channel. */
    const shared = [...suffixesOfKind].filter(([, suffixes]) => suffixes.size > 1);
    const split = [...kindsOfSuffix].filter(([, kinds]) => kinds.size > 1);
    expect(shared.map(([kind, suffixes]) => [kind, [...suffixes]])).toEqual([]);
    expect(split.map(([suffix, kinds]) => [suffix, [...kinds]])).toEqual([]);
  });
});
