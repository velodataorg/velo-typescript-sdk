import { FUTURES_EXCHANGES } from "../../market/exchanges.ts";
import type { FuturesExchange } from "../../market/exchanges.ts";
import { buildChannel } from "../helpers/build.ts";
import type { ChannelDefinition, ChannelFor } from "../helpers/build.ts";
import { parseTarget } from "../helpers/target.ts";
import type { Target } from "../helpers/target.ts";

const INDICATOR = "channels.tape";

/* How many trades the one-minute candle in progress has seen so far: buys, then sells. */
const TAPE = {
  suffix: "#tape#Trade Count",
  kind: "tape",
  columns: ["buy_trades", "sell_trades"],
} as const satisfies ChannelDefinition;

/**
 * The live count of buy and sell trades of one futures product, or of a coin
 * across exchanges.
 *
 * @remarks
 * Named as the server names it; history's `trades()` selects the same
 * columns. The total is not sent; it is the two added.
 *
 * For a product, each frame decodes to the one-minute candle in progress as a
 * history row of `buy_trades` and `sell_trades`, so a caller can seed from
 * history and continue from live by upserting on `time`. Both count up within
 * the minute and start again from the first trade of the next; the last row
 * of a minute equals its history row. Frames arrive several times a second.
 *
 * For a coin, the kind gains an `aggregated_` prefix and each frame decodes
 * to one entry per exchange the coin trades on, holding that exchange's count
 * so far in its own minute, in the same columns. An entry has no `time` and
 * no `product`: the server bundles every exchange's latest candle under one
 * tick time, and near a minute boundary some have already started again while
 * others have not, so a sum across exchanges can mix two minutes there. For
 * rows that match history, follow each exchange's product instead: the
 * catalog lists one per exchange for a coin.
 *
 * @param target - A product, as the catalog returns it, or a coin, such as
 * `{ coin: "BTC" }`.
 * @returns The frozen channel.
 * @throws A VeloError when the target is not usable.
 */
export function tape<T extends Target<FuturesExchange>>(
  target: T,
): ChannelFor<T, FuturesExchange, typeof TAPE> {
  const parsedTarget = parseTarget(target, FUTURES_EXCHANGES, INDICATOR);

  const channel = buildChannel(parsedTarget, FUTURES_EXCHANGES, TAPE);
  /* Which channel it is follows T, which the compiler cannot see from here. */
  return channel as ChannelFor<T, FuturesExchange, typeof TAPE>;
}
