import { FUTURES_EXCHANGES } from "../../market/exchanges.ts";
import type { FuturesExchange } from "../../market/exchanges.ts";
import { buildChannel } from "../helpers/build.ts";
import type { ChannelDefinition, ChannelFor } from "../helpers/build.ts";
import { option, parseOptions } from "../helpers/options.ts";
import { parseTarget } from "../helpers/target.ts";
import type { Target } from "../helpers/target.ts";

const INDICATOR = "channels.volume";

/*
 * Every futures volume channel the server publishes. Each sends what has
 * traded so far in the one-minute candle in progress: the buy volume, then
 * the sell volume. The two are different kinds of channel because they fill
 * different columns; a listener narrows `data` on `kind`.
 */
const DEFINITIONS = {
  coins: {
    suffix: "#volume#Coins",
    kind: "volume_coins",
    columns: ["buy_coin_volume", "sell_coin_volume"],
  },
  dollars: {
    suffix: "#volume#Dollars",
    kind: "volume_dollars",
    columns: ["buy_dollar_volume", "sell_dollar_volume"],
  },
} as const satisfies Readonly<Record<string, ChannelDefinition>>;

type Definitions = typeof DEFINITIONS;

/* What a caller may pass. Each metric is named as its definition is. */
const METRICS = ["coins", "dollars"] as const;
const OPTIONS = { metric: option(METRICS, "dollars") };

type Metric = (typeof METRICS)[number];

/**
 * The live buy and sell volume of one futures product, or of a coin across
 * exchanges.
 *
 * @remarks
 * Spelled like the history builder's `volume({ metric })`, with the metrics
 * in the plural as every channel option is: `coins` or `dollars`, defaulting
 * to `dollars` as history defaults to `dollar`. The total is not sent; it is
 * the two added, or `channels.price`'s `coin_volume` and `dollar_volume`.
 *
 * For a product, each frame decodes to the one-minute candle in progress as a
 * history row of that metric's buy and sell volume, so a caller can seed from
 * history and continue from live by upserting on `time`. Both are cumulative
 * within the minute and start again from the first trade of the next; the
 * last row of a minute equals its history row. Frames arrive several times a
 * second.
 *
 * For a coin, the kind gains an `aggregated_` prefix and each frame decodes
 * to one entry per exchange the coin trades on, holding that exchange's
 * volume so far in its own minute, in the same columns. An entry has no
 * `time` and no `product`: the server bundles every exchange's latest candle
 * under one tick time, and near a minute boundary some have already started
 * again while others have not, so a sum across exchanges can mix two minutes
 * there. For rows that match history, follow each exchange's product instead:
 * the catalog lists one per exchange for a coin.
 *
 * @param target - A product, as the catalog returns it, or a coin, such as
 * `{ coin: "BTC" }`.
 * @param options - The metric to measure volume in.
 * @returns The frozen channel.
 * @throws A VeloError when the target or an option is not usable.
 */
export function volume<T extends Target<FuturesExchange>, M extends Metric = "dollars">(
  target: T,
  options?: { readonly metric?: M },
): ChannelFor<T, FuturesExchange, Definitions[M]> {
  const { metric } = parseOptions(options, OPTIONS, INDICATOR);
  const parsedTarget = parseTarget(target, FUTURES_EXCHANGES, INDICATOR);

  const channel = buildChannel(parsedTarget, FUTURES_EXCHANGES, DEFINITIONS[metric]);
  /* Which channel it is follows T and M, which the compiler cannot see from here. */
  return channel as ChannelFor<T, FuturesExchange, Definitions[M]>;
}
