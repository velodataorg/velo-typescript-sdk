import type { z } from "zod";

import type { Row } from "../../data/row.ts";
import type { Product } from "../../market/product.ts";
import type { Channel } from "../channel.ts";
import { aggregatedDecoder, singleDecoder } from "./decode.ts";
import type { Columns, ExchangeEntry } from "./decode.ts";
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
 * Everything about one channel the server publishes except what it follows:
 * the words of its name, its kind, one payload as the server sends it, and
 * the history columns a payload fills.
 */
export interface ChannelDefinition<
  Payload,
  Kind extends string = string,
  C extends Columns = Columns,
> {
  readonly words: readonly string[];
  readonly kind: Kind;
  readonly payload: z.ZodType<Payload>;
  readonly columns: (payload: Payload) => C;
}

/* The least a definition is, whatever its payload. */
interface AnyDefinition {
  readonly kind: string;
  readonly columns: (payload: never) => Columns;
}

/* The channel a target gets for a definition: single for a product, aggregated for a coin. */
export type ChannelFor<T, X extends string, D extends AnyDefinition> = D extends AnyDefinition
  ? T extends Product<X>
    ? SingleChannel<X, D["kind"], keyof ReturnType<D["columns"]> & string>
    : AggregatedChannel<X, D["kind"], keyof ReturnType<D["columns"]> & string>
  : never;

/**
 * Builds a single channel: one product on one exchange.
 *
 * @param product - The product to follow.
 * @param definition - The channel to follow it on.
 * @returns The frozen channel.
 * @throws A VeloError when the name cannot be rendered.
 */
export function singleChannel<
  X extends string,
  Payload,
  const Kind extends string,
  C extends Columns,
>(
  product: Product<X>,
  definition: ChannelDefinition<Payload, Kind, C>,
): SingleChannel<X, Kind, keyof C & string> {
  const { words, kind, payload, columns } = definition;
  const name = renderSingleName(product, words);
  return Object.freeze({ kind, name, decode: singleDecoder(name, product, payload, columns) });
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
export function aggregatedChannel<
  X extends string,
  Payload,
  const Kind extends string,
  C extends Columns,
>(
  coin: string,
  exchanges: readonly X[],
  definition: ChannelDefinition<Payload, Kind, C>,
): AggregatedChannel<X, Kind, keyof C & string> {
  const { words, kind, payload, columns } = definition;
  const name = renderAggregatedName(coin, words);
  return Object.freeze({
    kind: `aggregated_${kind}` as const,
    name,
    decode: aggregatedDecoder(name, exchanges, coin, payload, columns),
  });
}
