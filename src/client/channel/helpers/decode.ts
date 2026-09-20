import { z } from "zod";

import { VeloError } from "../../../errors.ts";
import type { Row, RowBase } from "../../data/row.ts";
import type { Product } from "../../market/product.ts";
import type { ChannelFrame } from "../channel.ts";
import { entryExchange } from "./render.ts";

/* What a payload's values fill: one per history column, null where there is none. */
export type Columns = Readonly<Record<string, number | null>>;

/**
 * One exchange's share of an aggregated frame: a history row without the
 * fields the frame cannot supply.
 *
 * An aggregated frame bundles every exchange's latest payload under one tick
 * time, so which minute an entry belongs to is unknown, and it names no
 * product.
 */
export type ExchangeEntry<X extends string, C extends string> = {
  readonly exchange: X;
  readonly coin: string;
} & { readonly [K in C]: number | null };

/**
 * Builds the decoder of a single channel: each frame becomes a history row.
 *
 * @param name - The channel string, for the context of a frame it refuses.
 * @param product - The product the channel follows.
 * @param payload - One payload as the server sends it.
 * @param columns - Names one validated payload's values as the history
 * columns they fill.
 * @returns The decoder.
 */
export function singleDecoder<X extends string, Payload, C extends Columns>(
  name: string,
  product: Product<X>,
  payload: z.ZodType<Payload>,
  columns: (payload: Payload) => C,
): (frame: ChannelFrame) => Row<X, keyof C & string> {
  /* Every product frame carries its tick time beside the payload. */
  const schema = z.object({ d: payload, tt: z.number() });

  return decoderOf(name, schema, ({ d, tt }) => ({
    ...rowBase(product, tt),
    ...columns(d),
  }));
}

/**
 * Builds the decoder of an aggregated channel: each frame becomes one entry
 * per exchange.
 *
 * @remarks
 * An exchange the indicator does not list is skipped, so a release that
 * predates an exchange keeps working when the server adds it.
 *
 * @param name - The channel string, for the context of a frame it refuses.
 * @param exchanges - The exchanges that publish the indicator.
 * @param coin - The coin the channel follows.
 * @param payload - One exchange's payload as the server sends it.
 * @param columns - Names one validated payload's values as the history
 * columns they fill.
 * @returns The decoder.
 */
export function aggregatedDecoder<X extends string, Payload, C extends Columns>(
  name: string,
  exchanges: readonly X[],
  coin: string,
  payload: z.ZodType<Payload>,
  columns: (payload: Payload) => C,
): (frame: ChannelFrame) => readonly ExchangeEntry<X, keyof C & string>[] {
  /* One payload per exchange the coin trades on, keyed `realtime_<exchange>`. */
  const schema = z.object({ d: z.record(z.string(), payload) });

  return decoderOf(name, schema, ({ d }) => {
    const entries: ExchangeEntry<X, keyof C & string>[] = [];
    for (const [key, entry] of Object.entries(d)) {
      const exchange = exchanges.find((listed) => listed === entryExchange(key));
      if (exchange === undefined) continue;
      entries.push({ exchange, coin, ...columns(entry) });
    }
    return entries;
  });
}

/**
 * Wraps a reader of validated frames with the check that validates them.
 *
 * @param name - The channel string, for the context of a frame it refuses.
 * @param schema - What a frame of this channel must look like.
 * @param read - Shapes one validated frame into what listeners receive.
 * @returns A decoder that throws a VeloError for a frame the schema refuses.
 */
function decoderOf<Frame, Data>(
  name: string,
  schema: z.ZodType<Frame>,
  read: (frame: Frame) => Data,
): (frame: ChannelFrame) => Data {
  return (frame) => {
    const parsed = schema.safeParse(frame);
    if (!parsed.success) {
      throw new VeloError(`unexpected ${name} message:\n${z.prettifyError(parsed.error)}`, {
        cause: parsed.error,
      });
    }
    return read(parsed.data);
  };
}

const MINUTE_MS = 60_000;

/**
 * The fields every history row starts with, for a frame of a single channel.
 *
 * @remarks
 * Realtime frames describe the one-minute bucket in progress, and history
 * rows are timed at the start of their bucket, so the tick time is floored
 * to the minute to make the two line up.
 *
 * @param product - The product the channel follows.
 * @param tickTime - The frame's `tt`, in milliseconds.
 * @returns The exchange, coin, product, and bucket start.
 */
function rowBase<X extends string>(product: Product<X>, tickTime: number): RowBase<X> {
  return {
    exchange: product.exchange,
    coin: product.coin,
    product: product.product,
    time: Math.floor(tickTime / MINUTE_MS) * MINUTE_MS,
  };
}
