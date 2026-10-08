import { channels } from "../src/index.ts";
import type { Channel, Channels } from "../src/index.ts";

/* The targets every channel in `BUILT` follows, and so the ones the fixtures were captured for. */
export const PERP = { exchange: "binance-futures", coin: "BTC", product: "BTCUSDT" } as const;
export const SPOT = { exchange: "coinbase", coin: "BTC", product: "BTC-USD" } as const;
export const COIN = { coin: "BTC" } as const;

/*
 * Every channel the builders can build, one line each. The type makes a new
 * builder on `channels` a compile error here until it is listed; listing each
 * of its targets and options is by hand.
 */
export const BUILT: Readonly<
  Record<Exclude<keyof Channels, "raw" | "custom" | "feed">, readonly Channel[]>
> = {
  price: [channels.price(PERP), channels.price(SPOT)],
  openInterest: [
    channels.openInterest(PERP, { metric: "coins" }),
    channels.openInterest(PERP, { metric: "dollars" }),
    channels.openInterest(COIN, { metric: "coins" }),
    channels.openInterest(COIN, { metric: "dollars" }),
  ],
  fundingRate: [
    channels.fundingRate(PERP, { measure: "rate" }),
    channels.fundingRate(PERP, { measure: "coins" }),
    channels.fundingRate(PERP, { measure: "dollars" }),
    channels.fundingRate(COIN, { measure: "rate" }),
    channels.fundingRate(COIN, { measure: "coins" }),
    channels.fundingRate(COIN, { measure: "dollars" }),
    channels.fundingRate(COIN, { weighted: true }),
  ],
  volume: [
    channels.volume(PERP, { metric: "coins" }),
    channels.volume(PERP, { metric: "dollars" }),
    channels.volume(COIN, { metric: "coins" }),
    channels.volume(COIN, { metric: "dollars" }),
  ],
  tape: [channels.tape(PERP), channels.tape(COIN)],
  spotVolume: [
    channels.spotVolume(SPOT, { metric: "coins" }),
    channels.spotVolume(SPOT, { metric: "dollars" }),
    channels.spotVolume(COIN, { metric: "coins" }),
    channels.spotVolume(COIN, { metric: "dollars" }),
  ],
  spotTape: [channels.spotTape(SPOT), channels.spotTape(COIN)],
  premium: [
    channels.premium(PERP),
    channels.premium(COIN),
    channels.premium(COIN, { weighted: true }),
  ],
  liquidations: [channels.liquidations(PERP), channels.liquidations(COIN)],
  liquidationVolume: [
    channels.liquidationVolume(PERP, { metric: "coins" }),
    channels.liquidationVolume(PERP, { metric: "dollars" }),
    channels.liquidationVolume(COIN, { metric: "coins" }),
    channels.liquidationVolume(COIN, { metric: "dollars" }),
  ],
};
