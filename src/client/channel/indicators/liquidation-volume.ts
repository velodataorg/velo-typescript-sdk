import { FUTURES_EXCHANGES } from "../../market/exchanges.ts";
import type { FuturesExchange } from "../../market/exchanges.ts";
import { buildChannel } from "../helpers/build.ts";
import type { ChannelDefinition, ChannelFor } from "../helpers/build.ts";
import { option, parseOptions } from "../helpers/options.ts";
import { parseTarget } from "../helpers/target.ts";
import type { Target } from "../helpers/target.ts";

const INDICATOR = "channels.liquidationVolume";

/*
 * Every liquidation volume channel the server publishes. Each sends what has
 * been liquidated so far in the one-minute candle in progress: by forced
 * buys, which close shorts, then by forced sells, which close longs. The two
 * are different kinds of channel because they fill different columns.
 */
const DEFINITIONS = {
  coins: {
    suffix: "#liquidations#Coins",
    kind: "liquidation_volume_coins",
    columns: ["buy_liquidations_coin_volume", "sell_liquidations_coin_volume"],
  },
  dollars: {
    suffix: "#liquidations#Dollars",
    kind: "liquidation_volume_dollars",
    columns: ["buy_liquidations_dollar_volume", "sell_liquidations_dollar_volume"],
  },
} as const satisfies Readonly<Record<string, ChannelDefinition>>;

type Definitions = typeof DEFINITIONS;

/* What a caller may pass. Each metric is named as its definition is. */
const METRICS = ["coins", "dollars"] as const;
const OPTIONS = { metric: option(METRICS, "dollars") };

type Metric = (typeof METRICS)[number];

/**
 * The live liquidated volume of one futures product, or of a coin across
 * exchanges.
 *
 * @remarks
 * Spelled like the history builder's `liquidationVolume({ metric })`, with
 * the metrics in the plural as every channel option is: `coins` or `dollars`,
 * defaulting to `dollars` as history defaults to `dollar`. A buy is a forced
 * buy, which closes a short; a sell closes a long. The total is not sent; it
 * is the two added. For how many liquidations rather than how much, see
 * `channels.liquidations`.
 *
 * Only binance-futures, bybit, deribit, hyperliquid, and okex-swap publish
 * live liquidations. The server accepts a product of binance-coin-margin,
 * bybit-coin-margin, or okex-coin-margin and then sends nothing for it, not
 * even zeros, though history has their liquidations. An exchange that does
 * publish sends a frame at least every ten seconds, liquidations or not, so
 * silence means the exchange is one of the three.
 *
 * For a product, each frame decodes to the one-minute candle in progress as a
 * history row of that metric's buy and sell liquidation volume, so a caller
 * can seed from history and continue from live by upserting on `time`. Both
 * are cumulative within the minute and start again at zero in the next; the
 * last row of a minute equals its history row.
 *
 * For a coin, the kind gains an `aggregated_` prefix and each frame decodes
 * to one entry per exchange that publishes, holding that exchange's volume so
 * far in its own minute, in the same columns. The three silent exchanges have
 * no entry, so a sum across entries is lower than history's for the coin. An
 * entry has no `time` and no `product`: the server bundles every exchange's
 * latest candle under one tick time, and near a minute boundary some have
 * already started again while others have not, so a sum can mix two minutes
 * there.
 *
 * @param target - A product, as the catalog returns it, or a coin, such as
 * `{ coin: "BTC" }`.
 * @param options - The metric to measure liquidated volume in.
 * @returns The frozen channel.
 * @throws A VeloError when the target or an option is not usable.
 */
export function liquidationVolume<T extends Target<FuturesExchange>, M extends Metric = "dollars">(
  target: T,
  options?: { readonly metric?: M },
): ChannelFor<T, FuturesExchange, Definitions[M]> {
  const { metric } = parseOptions(options, OPTIONS, INDICATOR);
  const parsedTarget = parseTarget(target, FUTURES_EXCHANGES, INDICATOR);

  const channel = buildChannel(parsedTarget, FUTURES_EXCHANGES, DEFINITIONS[metric]);
  /* Which channel it is follows T and M, which the compiler cannot see from here. */
  return channel as ChannelFor<T, FuturesExchange, Definitions[M]>;
}
