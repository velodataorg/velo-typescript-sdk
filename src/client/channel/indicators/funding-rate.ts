import { assert } from "../../../util/assert.ts";
import { FUTURES_EXCHANGES } from "../../market/exchanges.ts";
import type { FuturesExchange } from "../../market/exchanges.ts";
import type { Channel } from "../channel.ts";
import { aggregatedChannel, singleChannel } from "../helpers/build.ts";
import type { ChannelDefinition, ChannelFor } from "../helpers/build.ts";
import { flag, option, parseOptions } from "../helpers/options.ts";
import { parseTarget } from "../helpers/target.ts";
import type { Coin, Target } from "../helpers/target.ts";

const BUILDER = "channel.fundingRate";

/*
 * Every measure sends its current value, bare. The three are different kinds
 * of channel because they fill different columns; a listener narrows `data`
 * on `kind`. History has the rate's column and none for what is spent, so
 * those two are named here, in the manner of the history columns measured in
 * coins and in dollars.
 */
const MEASURES = {
  /* The server words it `Rate (%)` and sends a fraction, as history does: 0.0001 is 0.01%. */
  rate: {
    suffix: "#funding_rate#Rate (%)",
    kind: "funding_rate",
    columns: "funding_rate",
  },
  coins: {
    suffix: "#funding_rate#Total Spend Rate (Coins)",
    kind: "funding_spend_rate_coins",
    columns: "coin_funding_spend_rate",
  },
  /* Sent again on every price change, so far more often than the other two. */
  dollars: {
    suffix: "#funding_rate#Total Spend Rate ($)",
    kind: "funding_spend_rate_dollars",
    columns: "dollar_funding_spend_rate",
  },
} as const satisfies Readonly<Record<string, ChannelDefinition>>;

type Measures = typeof MEASURES;

/* The one channel whose payload differs: a coin's rate, then the open interest that weights it. */
const WEIGHTED_RATE = {
  suffix: "#funding_rate#Rate (%)#weighted",
  kind: "funding_rate_weighted",
  columns: ["funding_rate", "coin_open_interest_close"],
} as const satisfies ChannelDefinition;

const OPTIONS = { measure: option(MEASURES, "rate"), weighted: flag() };

/* The definition a caller's options select. */
type Selected<M extends keyof Measures, W extends boolean> = W extends true
  ? typeof WEIGHTED_RATE
  : Measures[M];

/**
 * The live funding rate of one futures product, or of a coin across exchanges.
 *
 * @remarks
 * `measure` picks one of three kinds of channel. `rate`, the default, is the
 * funding rate as history's `funding_rate` has it, so for a product a caller
 * can seed from history and continue from live by upserting on `time`. `coins`
 * and `dollars` are what the open interest pays at that rate, the rate times
 * open interest; history has no column for either. Each frame carries the
 * current value, and for a product decodes to a row timed at the start of its
 * minute.
 *
 * For a coin, the kind gains an `aggregated_` prefix and each frame decodes
 * to one entry per exchange the coin trades on, holding that exchange's
 * current value in the same column. An entry has no `time` and no `product`.
 *
 * With `weighted`, each entry also carries `coin_open_interest_close`, the
 * exchange's current open interest in coins. The server sends the weights,
 * not the average: a rate weighted by open interest is the sum of rate times
 * open interest over the sum of open interest. The server publishes this for
 * a coin's rate only, so any other combination is refused.
 *
 * @param target - A product, as the catalog returns it, or a coin, such as
 * `{ coin: "BTC" }`.
 * @param options - The measure, and whether to send the weights.
 * @returns The frozen channel.
 * @throws A VeloError when the target or an option is not usable, or the
 * server publishes no such channel.
 */
export function fundingRate<
  T extends Target<FuturesExchange>,
  M extends keyof Measures = "rate",
  W extends boolean = false,
>(
  target: T,
  options?: {
    /* What to measure: the rate, or what open interest pays at it, in coins or in dollars. */
    readonly measure?: M;
    /*
     * Sends each exchange's open interest beside its rate, to weight the rates
     * by. The server publishes this for a coin only, and only for the rate. A
     * target that may be a product, or a measure that may not be the rate, is
     * refused too, so `T` and `M` are checked whole.
     */
    readonly weighted?: W & ([T] extends [Coin] ? ([M] extends ["rate"] ? boolean : false) : false);
  },
): ChannelFor<T, FuturesExchange, Selected<M, W>> {
  const { measure, weighted } = parseOptions(BUILDER, options, OPTIONS);
  const parsed = parseTarget(BUILDER, FUTURES_EXCHANGES, target);

  const definition = MEASURES[measure];
  assert(
    !weighted || (parsed.scope === "aggregated" && measure === "rate"),
    () => `${BUILDER}() weights only the rate of a coin, such as { coin: "BTC" }`,
  );

  const channel: Channel =
    parsed.scope === "single"
      ? singleChannel(parsed.product, definition)
      : aggregatedChannel(parsed.coin, FUTURES_EXCHANGES, weighted ? WEIGHTED_RATE : definition);
  /* Which branch ran follows T, M, and W, which the compiler cannot see from here. */
  return channel as ChannelFor<T, FuturesExchange, Selected<M, W>>;
}
