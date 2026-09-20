import type { Row } from "../../data/row.ts";
import type { Product } from "../../market/product.ts";
import type { Channel } from "../channel.ts";
import { aggregatedDecoder, singleDecoder } from "./decode.ts";
import type { ColumnNames, ColumnOf, ExchangeEntry } from "./decode.ts";
import { renderAggregatedName, renderSingleName } from "./render.ts";
import type { ParsedTarget } from "./target.ts";

/*
 * The two channels an indicator can be followed as, and the one place each is
 * put together. An aggregated channel's kind is its single channel's with an
 * `aggregated_` prefix, which the type and the value below both say once.
 */

/*
 * Everything about one channel the server publishes except what it follows.
 */
export interface ChannelDefinition {
  /* What the server's list calls it, verbatim, such as `#open_interest#Coins`; empty for price. */
  readonly suffix: string;
  /* What a listener narrows `data` on. The SDK's own name for the channel. */
  readonly kind: string;
  /* The history columns a payload fills, by position. */
  readonly columns: ColumnNames;
}

/* A definition followed for one product on one exchange: each frame is a history row. */
export type SingleChannel<
  X extends string,
  D extends ChannelDefinition,
> = D extends ChannelDefinition ? Channel<D["kind"], Row<X, ColumnOf<D["columns"]>>> : never;

/* A definition followed for one coin across exchanges: each frame is one entry per exchange. */
export type AggregatedChannel<
  X extends string,
  D extends ChannelDefinition,
> = D extends ChannelDefinition
  ? Channel<`aggregated_${D["kind"]}`, readonly ExchangeEntry<X, ColumnOf<D["columns"]>>[]>
  : never;

/* The channel a target gets: single for a product, aggregated for a coin. */
export type ChannelFor<T, X extends string, D extends ChannelDefinition> =
  T extends Product<X> ? SingleChannel<X, D> : AggregatedChannel<X, D>;

/**
 * Builds the channel a parsed target gets: single for a product, aggregated
 * for a coin.
 *
 * @param target - The target, as `parseTarget` returned it.
 * @param exchanges - The exchanges that publish the indicator.
 * @param definition - The channel to follow it on.
 * @returns The frozen channel. Which one it is follows the caller's target,
 * so the indicator that knows its type says so.
 * @throws A VeloError when the name cannot be rendered.
 */
export function buildChannel<X extends string>(
  target: ParsedTarget<X>,
  exchanges: readonly X[],
  definition: ChannelDefinition,
): Channel {
  return target.scope === "single"
    ? singleChannel(target.product, definition)
    : aggregatedChannel(target.coin, exchanges, definition);
}

/**
 * Builds a single channel: one product on one exchange.
 *
 * @param product - The product to follow.
 * @param definition - The channel to follow it on.
 * @returns The frozen channel.
 * @throws A VeloError when the name cannot be rendered.
 */
export function singleChannel<X extends string, const D extends ChannelDefinition>(
  product: Product<X>,
  definition: D,
): SingleChannel<X, D> {
  const { suffix, kind, columns }: ChannelDefinition = definition;
  const name = renderSingleName(product, suffix);
  const built = Object.freeze({ kind, name, decode: singleDecoder(name, product, columns) });
  /* The kind and the columns are the definition's, which its literal type says and the value cannot. */
  return built as SingleChannel<X, D>;
}

/**
 * Builds an aggregated channel: one coin across exchanges.
 *
 * @param coin - The coin to follow.
 * @param exchanges - The exchanges that publish the indicator.
 * @param definition - The channel to follow it on; its kind is that of the
 * single channel.
 * @returns The frozen channel, its kind prefixed `aggregated_`.
 * @throws A VeloError when the name cannot be rendered.
 */
export function aggregatedChannel<X extends string, const D extends ChannelDefinition>(
  coin: string,
  exchanges: readonly X[],
  definition: D,
): AggregatedChannel<X, D> {
  const { suffix, kind, columns }: ChannelDefinition = definition;
  const name = renderAggregatedName(coin, suffix);
  const built = Object.freeze({
    kind: `aggregated_${kind}`,
    name,
    decode: aggregatedDecoder(name, exchanges, coin, columns),
  });
  /* The kind and the columns are the definition's, which its literal type says and the value cannot. */
  return built as AggregatedChannel<X, D>;
}
