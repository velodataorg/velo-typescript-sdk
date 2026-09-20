import type { Row } from "../../data/row.ts";
import type { Product } from "../../market/product.ts";
import type { Channel } from "../channel.ts";
import { aggregatedDecoder, singleDecoder } from "./decode.ts";
import type { ColumnNames, ColumnOf, ExchangeEntry } from "./decode.ts";
import { renderAggregatedName, renderSingleName } from "./render.ts";

/*
 * The two channels an indicator can be followed as, and the one place each is
 * put together. An aggregated channel's kind is its single channel's with an
 * `aggregated_` prefix, which the type and the value below both say once.
 */

/* One product on one exchange: each frame is a history row. */
export type SingleChannel<X extends string, Kind extends string, C extends string> = Channel<
  Kind,
  Row<X, C>
>;

/* One coin across exchanges: each frame is one entry per exchange. */
export type AggregatedChannel<X extends string, Kind extends string, C extends string> = Channel<
  `aggregated_${Kind}`,
  readonly ExchangeEntry<X, C>[]
>;

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

/* The channel a target gets for a definition: single for a product, aggregated for a coin. */
export type ChannelFor<
  T,
  X extends string,
  D extends ChannelDefinition,
> = D extends ChannelDefinition
  ? T extends Product<X>
    ? SingleChannel<X, D["kind"], ColumnOf<D["columns"]>>
    : AggregatedChannel<X, D["kind"], ColumnOf<D["columns"]>>
  : never;

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
): SingleChannel<X, D["kind"], ColumnOf<D["columns"]>> {
  const { suffix, kind, columns }: ChannelDefinition = definition;
  const name = renderSingleName(product, suffix);
  const built = Object.freeze({ kind, name, decode: singleDecoder(name, product, columns) });
  /* The kind and the columns are the definition's, which its literal type says and the value cannot. */
  return built as SingleChannel<X, D["kind"], ColumnOf<D["columns"]>>;
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
): AggregatedChannel<X, D["kind"], ColumnOf<D["columns"]>> {
  const { suffix, kind, columns }: ChannelDefinition = definition;
  const name = renderAggregatedName(coin, suffix);
  const built = Object.freeze({
    kind: `aggregated_${kind}`,
    name,
    decode: aggregatedDecoder(name, exchanges, coin, columns),
  });
  /* The kind and the columns are the definition's, which its literal type says and the value cannot. */
  return built as AggregatedChannel<X, D["kind"], ColumnOf<D["columns"]>>;
}
