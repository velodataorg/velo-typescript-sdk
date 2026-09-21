import { channel } from "../src/index.ts";
import type { Channel } from "../src/index.ts";

/* The targets every channel in `BUILT` follows, and so the ones the fixtures were captured for. */
export const PERP = { exchange: "binance-futures", coin: "BTC", product: "BTCUSDT" } as const;
export const SPOT = { exchange: "coinbase", coin: "BTC", product: "BTC-USD" } as const;
export const COIN = { coin: "BTC" } as const;

/*
 * Every channel the builders can build, one line each. The type makes a new
 * builder on `channel` a compile error here until it is listed; listing each
 * of its targets and options is by hand.
 */
export const BUILT: Readonly<Record<Exclude<keyof typeof channel, "raw">, readonly Channel[]>> = {
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
