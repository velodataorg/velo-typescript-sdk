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

type ServerList = keyof typeof SERVER;

const PERP = { exchange: "binance-futures", coin: "BTC", product: "BTCUSDT" } as const;
const SPOT = { exchange: "coinbase", coin: "BTC", product: "BTC-USD" } as const;
const COIN = { coin: "BTC" } as const;

/* How the server spells each list's target, for the targets above. */
const TARGET: Readonly<Record<ServerList, string>> = {
  futuresProduct: "realtime_binance-futures:BTCUSDT",
  spotProduct: "realtime_coinbase:BTC-USD",
  futuresCoin: "realtime_BTC",
  spotCoin: "realtime_BTC",
};

interface Built {
  /* The server list this channel's suffix must be in. */
  readonly list: ServerList;
  readonly built: Channel;
}

/*
 * Every channel the builders can build, one line each. The type makes a new
 * builder on `channel` a compile error here until it is listed; listing each
 * of its targets and options is by hand.
 */
const BUILT: Readonly<Record<Exclude<keyof typeof channel, "raw">, readonly Built[]>> = {
  price: [
    { list: "futuresProduct", built: channel.price(PERP) },
    { list: "spotProduct", built: channel.price(SPOT) },
  ],
  openInterest: [
    { list: "futuresProduct", built: channel.openInterest(PERP, { metric: "coins" }) },
    { list: "futuresProduct", built: channel.openInterest(PERP, { metric: "dollars" }) },
    { list: "futuresCoin", built: channel.openInterest(COIN, { metric: "coins" }) },
    { list: "futuresCoin", built: channel.openInterest(COIN, { metric: "dollars" }) },
  ],
  fundingRate: [
    { list: "futuresProduct", built: channel.fundingRate(PERP, { measure: "rate" }) },
    { list: "futuresProduct", built: channel.fundingRate(PERP, { measure: "coins" }) },
    { list: "futuresProduct", built: channel.fundingRate(PERP, { measure: "dollars" }) },
    { list: "futuresCoin", built: channel.fundingRate(COIN, { measure: "rate" }) },
    { list: "futuresCoin", built: channel.fundingRate(COIN, { measure: "coins" }) },
    { list: "futuresCoin", built: channel.fundingRate(COIN, { measure: "dollars" }) },
    { list: "futuresCoin", built: channel.fundingRate(COIN, { weighted: true }) },
  ],
};

/* What the server publishes and no builder builds yet. Delete a line when its builder lands. */
const NOT_BUILT: Readonly<Record<ServerList, readonly string[]>> = {
  futuresProduct: [
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
  spotProduct: ["#spotvol#Coins", "#spotvol#Dollars", "#spottape#Trade Count"],
  futuresCoin: [
    "#volume#Coins#Aggregated",
    "#volume#Dollars#Aggregated",
    "#tape#Trade Count#Aggregated",
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
};

const ALL = Object.entries(BUILT).flatMap(([builder, rows]) =>
  rows.map(({ list, built }) => ({ builder, list, kind: built.kind, name: built.name })),
);

describe("the channels the server publishes", () => {
  it.each(ALL)("$builder builds a name the server publishes: $name", (row) => {
    const published: readonly string[] = SERVER[row.list];
    expect(published).toContain(suffixOf(row));
  });

  it("gives every channel its own kind, so a listener can narrow on it", () => {
    const suffixesOfKind = new Map<string, Set<string>>();
    const kindsOfSuffix = new Map<string, Set<string>>();
    for (const row of ALL) {
      const suffix = suffixOf(row);
      suffixesOfKind.set(row.kind, (suffixesOfKind.get(row.kind) ?? new Set()).add(suffix));
      kindsOfSuffix.set(suffix, (kindsOfSuffix.get(suffix) ?? new Set()).add(row.kind));
    }
    /* Price is one kind on futures and on spot: the same suffix, so the same channel. */
    const shared = [...suffixesOfKind].filter(([, suffixes]) => suffixes.size > 1);
    const split = [...kindsOfSuffix].filter(([, kinds]) => kinds.size > 1);
    expect(shared.map(([kind, suffixes]) => [kind, [...suffixes]])).toEqual([]);
    expect(split.map(([suffix, kinds]) => [suffix, [...kinds]])).toEqual([]);
  });

  it("lists what the server publishes and no builder builds yet", () => {
    for (const list of Object.keys(SERVER) as ServerList[]) {
      const built = new Set(ALL.filter((row) => row.list === list).map(suffixOf));
      const missing = SERVER[list].filter((suffix) => !built.has(suffix));
      expect([list, missing]).toEqual([list, NOT_BUILT[list]]);
    }
  });
});

/**
 * The part of a channel's name after its target, which is what the server lists.
 *
 * @param row - A built channel and the list it belongs to.
 * @returns The suffix, such as `#open_interest#Coins`; empty for price.
 */
function suffixOf(row: { readonly list: ServerList; readonly name: string }): string {
  expect(row.name.startsWith(TARGET[row.list])).toBe(true);
  return row.name.slice(TARGET[row.list].length);
}
