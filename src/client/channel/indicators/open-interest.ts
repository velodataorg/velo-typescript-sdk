import { FUTURES_EXCHANGES } from "../../market/exchanges.ts";
import type { FuturesExchange } from "../../market/exchanges.ts";
import { buildChannel } from "../helpers/build.ts";
import type { ChannelDefinition, ChannelFor } from "../helpers/build.ts";
import { option, parseOptions } from "../helpers/options.ts";
import { parseTarget } from "../helpers/target.ts";
import type { Target } from "../helpers/target.ts";

const INDICATOR = "channels.openInterest";

/*
 * Every open interest channel the server publishes. Each sends the one-minute
 * candle in progress: high, low, then close. The two are different kinds of
 * channel because they fill different columns.
 */
const DEFINITIONS = {
  /* A new frame arrives when the exchange reports a value, every one to a few seconds. */
  coins: {
    suffix: "#open_interest#Coins",
    kind: "open_interest_coins",
    columns: ["coin_open_interest_high", "coin_open_interest_low", "coin_open_interest_close"],
  },
  /* The server recomputes close as coin close times last trade price on every price change. */
  dollars: {
    suffix: "#open_interest#Dollars",
    kind: "open_interest_dollars",
    columns: [
      "dollar_open_interest_high",
      "dollar_open_interest_low",
      "dollar_open_interest_close",
    ],
  },
} as const satisfies Readonly<Record<string, ChannelDefinition>>;

type Definitions = typeof DEFINITIONS;

/* What a caller may pass. Each metric is named as its definition is. */
const METRICS = ["coins", "dollars"] as const;
const OPTIONS = { metric: option(METRICS, "dollars") };

type Metric = (typeof METRICS)[number];

/**
 * The live open interest of one futures product, or of a coin across exchanges.
 *
 * @remarks
 * Spelled like the history builder's `openInterest(..., { metric })`, with
 * the metrics in the plural as every channel option is: `coins` or `dollars`,
 * defaulting to `dollars` as history defaults to `dollar`.
 *
 * For a product, each frame decodes to the one-minute candle in progress as a
 * history row of that metric's high, low, and close, so a caller can seed
 * from history and continue from live by upserting on `time`. With `coins`,
 * the last row of a minute equals its history row. With `dollars`, high and
 * low do and close does not: a live close is the coin close valued at the
 * last trade price, sent again on every price change, so it can lie outside
 * the candle's high and low. History values each sample at the mark price the
 * exchange reported with it. The two differ by a few hundredths of a percent;
 * once a minute has closed, its history row is the settled value.
 *
 * For a coin, the kind gains an `aggregated_` prefix and each frame decodes
 * to one entry per exchange the coin trades on, holding that exchange's
 * candle in the same columns. An entry has no `time` and no `product`: the
 * server bundles every exchange's latest candle under one tick time, and near
 * a minute boundary some have already rolled over while others have not, so
 * an entry cannot be placed in a minute. `close` is always the current value,
 * so sums across exchanges are exact; keep a high and low by merging with max
 * and min rather than replacing. For rows that match history, follow each
 * exchange's product instead: the catalog lists one per exchange for a coin.
 *
 * @param target - A product, as the catalog returns it, or a coin, such as
 * `{ coin: "BTC" }`.
 * @param options - The metric to measure open interest in.
 * @returns The frozen channel.
 * @throws A VeloError when the target or an option is not usable.
 */
export function openInterest<T extends Target<FuturesExchange>, M extends Metric = "dollars">(
  target: T,
  options?: { readonly metric?: M },
): ChannelFor<T, FuturesExchange, Definitions[M]> {
  const { metric } = parseOptions(options, OPTIONS, INDICATOR);
  const parsedTarget = parseTarget(target, FUTURES_EXCHANGES, INDICATOR);

  const channel = buildChannel(parsedTarget, FUTURES_EXCHANGES, DEFINITIONS[metric]);
  /* Which channel it is follows T and M, which the compiler cannot see from here. */
  return channel as ChannelFor<T, FuturesExchange, Definitions[M]>;
}
