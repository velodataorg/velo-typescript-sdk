import { assert } from "../../../util/assert.ts";
import { FUTURES_EXCHANGES } from "../../market/exchanges.ts";
import type { FuturesExchange } from "../../market/exchanges.ts";
import { buildChannel } from "../helpers/build.ts";
import type { ChannelDefinition, ChannelFor } from "../helpers/build.ts";
import { flag, parseOptions } from "../helpers/options.ts";
import { parseTarget } from "../helpers/target.ts";
import type { Coin, Target } from "../helpers/target.ts";

const INDICATOR = "channels.premium";

/*
 * Every premium channel the server publishes. Each sends the premium of the
 * one-minute candle in progress, then that candle's open price.
 */
const DEFINITIONS = {
  premium: {
    suffix: "#premium",
    kind: "premium",
    columns: ["premium", "open_price"],
  },
  /*
   * Published for a coin only, and chosen by the `weighted` flag. Its payload
   * ends with the open interest that weights the premium.
   */
  weightedPremium: {
    suffix: "#premium#weighted",
    kind: "premium_weighted",
    columns: ["premium", "open_price", "coin_open_interest_close"],
  },
} as const satisfies Readonly<Record<string, ChannelDefinition>>;

type Definitions = typeof DEFINITIONS;

/* What a caller may pass. */
const OPTIONS = { weighted: flag() };

/* The definition a caller's options select. */
type Selected<W extends boolean> = W extends true
  ? Definitions["weightedPremium"]
  : Definitions["premium"];

/**
 * The live premium of one futures product, or of a coin across exchanges.
 *
 * @remarks
 * The premium is the mark price less the index price, in the quote currency
 * and averaged over the minute so far, as history's `premium` has it; below
 * the index it is negative. `open_price` is the minute's open, sent beside it
 * so a caller can take the premium as a fraction of price.
 *
 * For a product, each frame decodes to the one-minute candle in progress as a
 * history row of `premium` and `open_price`, so a caller can seed from
 * history and continue from live by upserting on `time`. The last row of a
 * minute equals its history row. A new minute opens holding the previous
 * minute's premium until its own first sample arrives.
 *
 * For a coin, the kind gains an `aggregated_` prefix and each frame decodes
 * to one entry per exchange the coin trades on, holding that exchange's
 * current premium and open in the same columns. An entry has no `time` and no
 * `product`: the server bundles every exchange's latest candle under one tick
 * time, and near a minute boundary some have already rolled over while others
 * have not.
 *
 * With `weighted`, each entry also carries `coin_open_interest_close`, the
 * exchange's current open interest in coins. The server sends the weights,
 * not the average: a premium weighted by open interest is the sum of premium
 * times open interest over the sum of open interest. The server publishes
 * this for a coin only, so a product is refused.
 *
 * @param target - A product, as the catalog returns it, or a coin, such as
 * `{ coin: "BTC" }`.
 * @param options - Whether to send the weights.
 * @returns The frozen channel.
 * @throws A VeloError when the target or an option is not usable, or the
 * server publishes no such channel.
 */
export function premium<T extends Target<FuturesExchange>, W extends boolean = false>(
  target: T,
  options?: {
    /*
     * Sends each exchange's open interest beside its premium, to weight the
     * premiums by. The server publishes this for a coin only. A target that
     * may be a product is refused too, so `T` is checked whole.
     */
    readonly weighted?: W & ([T] extends [Coin] ? boolean : false);
  },
): ChannelFor<T, FuturesExchange, Selected<W>> {
  const { weighted } = parseOptions(options, OPTIONS, INDICATOR);
  const parsedTarget = parseTarget(target, FUTURES_EXCHANGES, INDICATOR);

  assert(
    !weighted || parsedTarget.scope === "aggregated",
    () => `${INDICATOR}() weights only the premium of a coin, such as { coin: "BTC" }`,
  );

  const definition = weighted ? DEFINITIONS.weightedPremium : DEFINITIONS.premium;
  const channel = buildChannel(parsedTarget, FUTURES_EXCHANGES, definition);
  /* Which channel it is follows T and W, which the compiler cannot see from here. */
  return channel as ChannelFor<T, FuturesExchange, Selected<W>>;
}
