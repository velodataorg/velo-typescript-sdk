import { channel } from "../../index.ts";
import type { Channel } from "./channel.ts";

/*
 * Every channel the builders can build, on real targets, for the checks that
 * need them all: the server's list of names, and a comparison of live rows
 * with history. Nothing the package exports reads this.
 */

/* The server's four lists of suffixes: a product or a coin, on futures or on spot. */
export type ServerList = "futuresProduct" | "spotProduct" | "futuresCoin" | "spotCoin";

export const PERP = { exchange: "binance-futures", coin: "BTC", product: "BTCUSDT" } as const;
export const SPOT = { exchange: "coinbase", coin: "BTC", product: "BTC-USD" } as const;
export const COIN = { coin: "BTC" } as const;

export interface Built {
  /* The server list this channel's suffix must be in, which also says what it follows. */
  readonly list: ServerList;
  readonly built: Channel;
}

/*
 * One line per channel. The type makes a new builder on `channel` a compile
 * error here until it is listed; listing each of its targets and options is
 * by hand.
 */
export const BUILT: Readonly<Record<Exclude<keyof typeof channel, "raw">, readonly Built[]>> = {
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
  volume: [
    { list: "futuresProduct", built: channel.volume(PERP, { metric: "coins" }) },
    { list: "futuresProduct", built: channel.volume(PERP, { metric: "dollars" }) },
    { list: "futuresCoin", built: channel.volume(COIN, { metric: "coins" }) },
    { list: "futuresCoin", built: channel.volume(COIN, { metric: "dollars" }) },
  ],
  tape: [
    { list: "futuresProduct", built: channel.tape(PERP) },
    { list: "futuresCoin", built: channel.tape(COIN) },
  ],
  spotVolume: [
    { list: "spotProduct", built: channel.spotVolume(SPOT, { metric: "coins" }) },
    { list: "spotProduct", built: channel.spotVolume(SPOT, { metric: "dollars" }) },
    { list: "spotCoin", built: channel.spotVolume(COIN, { metric: "coins" }) },
    { list: "spotCoin", built: channel.spotVolume(COIN, { metric: "dollars" }) },
  ],
};
