import { FUTURES_EXCHANGES } from "../../market/exchanges.ts";
import type { FuturesExchange } from "../../market/exchanges.ts";
import { buildChannel } from "../helpers/build.ts";
import type { ChannelDefinition, ChannelFor } from "../helpers/build.ts";
import { parseTarget } from "../helpers/target.ts";
import type { Target } from "../helpers/target.ts";

const INDICATOR = "channels.liquidations";

/*
 * How many liquidations the one-minute candle in progress has seen so far:
 * forced buys, which close shorts, then forced sells, which close longs.
 */
const LIQUIDATIONS = {
  suffix: "#liquidations#Liquidation Count",
  kind: "liquidations",
  columns: ["buy_liquidations", "sell_liquidations"],
} as const satisfies ChannelDefinition;

/**
 * The live count of liquidations of one futures product, or of a coin across
 * exchanges.
 *
 * @remarks
 * Spelled like the history builder's `liquidations()`, and in its columns. A
 * buy is a forced buy, which closes a short; a sell closes a long. For what
 * was liquidated rather than how many times, see `channels.liquidationVolume`.
 *
 * Only binance-futures, bybit, deribit, hyperliquid, and okex-swap publish
 * live liquidations. The server accepts a product of binance-coin-margin,
 * bybit-coin-margin, or okex-coin-margin and then sends nothing for it, not
 * even zeros, though history has their liquidations. An exchange that does
 * publish sends a frame at least every ten seconds, liquidations or not, so
 * silence means the exchange is one of the three.
 *
 * For a product, each frame decodes to the one-minute candle in progress as a
 * history row of `buy_liquidations` and `sell_liquidations`, so a caller can
 * seed from history and continue from live by upserting on `time`. Both count
 * up within the minute and start again at zero in the next; the last row of a
 * minute equals its history row.
 *
 * For a coin, the kind gains an `aggregated_` prefix and each frame decodes
 * to one entry per exchange that publishes, holding that exchange's count so
 * far in its own minute, in the same columns. The three silent exchanges have
 * no entry, so a sum across entries is lower than history's for the coin. An
 * entry has no `time` and no `product`: the server bundles every exchange's
 * latest candle under one tick time, and near a minute boundary some have
 * already started again while others have not, so a sum can mix two minutes
 * there.
 *
 * @param target - A product, as the catalog returns it, or a coin, such as
 * `{ coin: "BTC" }`.
 * @returns The frozen channel.
 * @throws A VeloError when the target is not usable.
 */
export function liquidations<T extends Target<FuturesExchange>>(
  target: T,
): ChannelFor<T, FuturesExchange, typeof LIQUIDATIONS> {
  const parsedTarget = parseTarget(target, FUTURES_EXCHANGES, INDICATOR);

  const channel = buildChannel(parsedTarget, FUTURES_EXCHANGES, LIQUIDATIONS);
  /* Which channel it is follows T, which the compiler cannot see from here. */
  return channel as ChannelFor<T, FuturesExchange, typeof LIQUIDATIONS>;
}
