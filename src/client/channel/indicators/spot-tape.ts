import { SPOT_EXCHANGES } from "../../market/exchanges.ts";
import type { SpotExchange } from "../../market/exchanges.ts";
import { buildChannel } from "../helpers/build.ts";
import type { ChannelDefinition, ChannelFor } from "../helpers/build.ts";
import { parseTarget } from "../helpers/target.ts";
import type { Target } from "../helpers/target.ts";

const INDICATOR = "channels.spotTape";

/*
 * How many trades the one-minute candle in progress has seen so far: buys,
 * then sells. The server words it `spottape`, apart from the futures `tape`.
 */
const SPOT_TAPE = {
  suffix: "#spottape#Trade Count",
  kind: "spot_tape",
  columns: ["buy_trades", "sell_trades"],
} as const satisfies ChannelDefinition;

/**
 * The live count of buy and sell trades of one spot product, or of a coin
 * across spot exchanges.
 *
 * @remarks
 * The spot counterpart of `channels.tape`. A coin cannot say which market it
 * means, so the two markets are two builders. History's spot `trades()`
 * selects the same columns. The total is not sent; it is the two added.
 *
 * For a product, each frame decodes to the one-minute candle in progress as a
 * history row of `buy_trades` and `sell_trades`, so a caller can seed from
 * history and continue from live by upserting on `time`. Both count up within
 * the minute and start again from the first trade of the next; the last row
 * of a minute equals its history row. Frames arrive a few times a second.
 *
 * For a coin, the kind gains an `aggregated_` prefix and each frame decodes
 * to one entry per spot exchange the coin trades on, holding that exchange's
 * count so far in its own minute, in the same columns. An entry has no `time`
 * and no `product`: the server bundles every exchange's latest candle under
 * one tick time, and near a minute boundary some have already started again
 * while others have not, so a sum across exchanges can mix two minutes there.
 * For rows that match history, follow each exchange's product instead.
 *
 * @param target - A spot product, as the catalog returns it, or a coin, such
 * as `{ coin: "BTC" }`.
 * @returns The frozen channel.
 * @throws A VeloError when the target is not usable.
 */
export function spotTape<T extends Target<SpotExchange>>(
  target: T,
): ChannelFor<T, SpotExchange, typeof SPOT_TAPE> {
  const parsedTarget = parseTarget(target, SPOT_EXCHANGES, INDICATOR);

  const channel = buildChannel(parsedTarget, SPOT_EXCHANGES, SPOT_TAPE);
  /* Which channel it is follows T, which the compiler cannot see from here. */
  return channel as ChannelFor<T, SpotExchange, typeof SPOT_TAPE>;
}
