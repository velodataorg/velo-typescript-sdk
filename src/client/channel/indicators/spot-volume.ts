import { SPOT_EXCHANGES } from "../../market/exchanges.ts";
import type { SpotExchange } from "../../market/exchanges.ts";
import { buildChannel } from "../helpers/build.ts";
import type { ChannelDefinition, ChannelFor } from "../helpers/build.ts";
import { option, parseOptions } from "../helpers/options.ts";
import { parseTarget } from "../helpers/target.ts";
import type { Target } from "../helpers/target.ts";

const INDICATOR = "channel.spotVolume";

/*
 * Every spot volume channel the server publishes. The server words them
 * `spotvol`, apart from the futures `volume` channels, so they are another
 * builder. Each sends what has traded so far in the one-minute candle in
 * progress: the buy volume, then the sell volume. The two are different kinds
 * of channel because they fill different columns; a listener narrows `data`
 * on `kind`.
 */
const DEFINITIONS = {
  coins: {
    suffix: "#spotvol#Coins",
    kind: "spot_volume_coins",
    columns: ["buy_coin_volume", "sell_coin_volume"],
  },
  dollars: {
    suffix: "#spotvol#Dollars",
    kind: "spot_volume_dollars",
    columns: ["buy_dollar_volume", "sell_dollar_volume"],
  },
} as const satisfies Readonly<Record<string, ChannelDefinition>>;

type Definitions = typeof DEFINITIONS;

/* What a caller may pass. Each metric is named as its definition is. */
const METRICS = ["coins", "dollars"] as const;
const OPTIONS = { metric: option(METRICS, "dollars") };

type Metric = (typeof METRICS)[number];

/**
 * The live buy and sell volume of one spot product, or of a coin across spot
 * exchanges.
 *
 * @remarks
 * The spot counterpart of `channel.volume`, with the same option: `coins` or
 * `dollars`, defaulting to `dollars` as history defaults to `dollar`. A coin
 * cannot say which market it means, so the two markets are two builders. The
 * total is not sent; it is the two added, or `channel.price`'s `coin_volume`
 * and `dollar_volume`.
 *
 * For a product, each frame decodes to the one-minute candle in progress as a
 * history row of that metric's buy and sell volume, so a caller can seed from
 * history and continue from live by upserting on `time`. Both are cumulative
 * within the minute and start again from the first trade of the next; the
 * last row of a minute equals its history row. Frames arrive a few times a
 * second.
 *
 * For a coin, the kind gains an `aggregated_` prefix and each frame decodes
 * to one entry per spot exchange the coin trades on, holding that exchange's
 * volume so far in its own minute, in the same columns. An entry has no
 * `time` and no `product`: the server bundles every exchange's latest candle
 * under one tick time, and near a minute boundary some have already started
 * again while others have not, so a sum across exchanges can mix two minutes
 * there. For rows that match history, follow each exchange's product instead.
 *
 * @param target - A spot product, as the catalog returns it, or a coin, such
 * as `{ coin: "BTC" }`.
 * @param options - The metric to measure volume in.
 * @returns The frozen channel.
 * @throws A VeloError when the target or an option is not usable.
 */
export function spotVolume<T extends Target<SpotExchange>, M extends Metric = "dollars">(
  target: T,
  options?: { readonly metric?: M },
): ChannelFor<T, SpotExchange, Definitions[M]> {
  const { metric } = parseOptions(options, OPTIONS, INDICATOR);
  const parsedTarget = parseTarget(target, SPOT_EXCHANGES, INDICATOR);

  const channel = buildChannel(parsedTarget, SPOT_EXCHANGES, DEFINITIONS[metric]);
  /* Which channel it is follows T and M, which the compiler cannot see from here. */
  return channel as ChannelFor<T, SpotExchange, Definitions[M]>;
}
