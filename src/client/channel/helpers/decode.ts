import { z } from "zod";

import { VeloError } from "../../../errors.ts";
import { assert } from "../../../util/assert.ts";
import type { Row, RowBase } from "../../data/row.ts";
import type { FuturesStandardColumn, SpotColumn } from "../../market/columns.ts";
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

/*
 * The two values the server publishes live and history has no column for,
 * so the only names here that are the SDK's own. Every other name a channel
 * fills is a history column, from the one list history is typed by.
 */
type ChannelOnlyColumn = "coin_funding_spend_rate" | "dollar_funding_spend_rate";

/* A name a channel's data may carry. */
export type Column = FuturesStandardColumn | SpotColumn | ChannelOnlyColumn;

/*
 * The columns a payload fills, by position: one name for a bare number, a
 * list for a tuple of numbers, and null for a position that fills no column.
 * Every payload the server sends is one or the other.
 */
export type ColumnNames = Column | readonly (Column | null)[];

/* The columns a list of names fills. */
export type ColumnOf<Names extends ColumnNames> = Names extends readonly (string | null)[]
  ? Exclude<Names[number], null>
  : Names;

/**
 * Builds the decoder of a single channel: each frame becomes a history row.
 *
 * @param name - The channel string, for the context of a frame it refuses.
 * @param product - The product the channel follows.
 * @param columns - The history columns a payload fills, by position.
 * @returns The decoder.
 */
export function singleDecoder<X extends string, const Names extends ColumnNames>(
  name: string,
  product: Product<X>,
  columns: Names,
): (frame: ChannelFrame) => Row<X, ColumnOf<Names>> {
  const payload = payloadOf(columns);
  /* Every product frame carries its tick time beside the payload. */
  const schema = z.object({ d: payload.schema, tt: z.number() });

  const decode = decoderOf(name, schema, ({ d, tt }) => ({
    ...rowBase(product, tt),
    ...payload.read(d),
  }));
  /* A row's keys are the names it was built from, which their literal type says and the value cannot. */
  return decode as (frame: ChannelFrame) => Row<X, ColumnOf<Names>>;
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
 * @param columns - The history columns one exchange's payload fills, by position.
 * @returns The decoder.
 */
export function aggregatedDecoder<X extends string, const Names extends ColumnNames>(
  name: string,
  exchanges: readonly X[],
  coin: string,
  columns: Names,
): (frame: ChannelFrame) => readonly ExchangeEntry<X, ColumnOf<Names>>[] {
  const payload = payloadOf(columns);
  /* One payload per exchange the coin trades on, keyed `realtime_<exchange>`. */
  const schema = z.object({ d: z.record(z.string(), payload.schema) });

  const decode = decoderOf(name, schema, ({ d }) => {
    const entries: object[] = [];
    for (const [key, entry] of Object.entries(d)) {
      const exchange = exchanges.find((listed) => listed === entryExchange(key));
      if (exchange === undefined) continue;
      entries.push({ exchange, coin, ...payload.read(entry) });
    }
    return entries;
  });
  /* An entry's keys are the names it was built from, which their literal type says and the value cannot. */
  return decode as (frame: ChannelFrame) => readonly ExchangeEntry<X, ColumnOf<Names>>[];
}

/**
 * What a payload must look like, and how its values are named, from the
 * columns it fills.
 *
 * @param columns - The history columns a payload fills, by position.
 * @returns The payload's schema, and a reader naming a validated payload's values.
 */
function payloadOf(columns: ColumnNames): {
  readonly schema: z.ZodType<number | readonly number[]>;
  readonly read: (payload: number | readonly number[]) => Columns;
} {
  if (typeof columns === "string") {
    return { schema: z.number(), read: (payload) => ({ [columns]: payload as number }) };
  }
  const [first, ...rest] = columns.map(() => z.number());
  assert(first !== undefined, "a channel's columns must name at least one position");
  return {
    schema: z.tuple([first, ...rest]),
    read: (payload) =>
      Object.fromEntries(
        columns.flatMap((column, position) =>
          column === null ? [] : [[column, (payload as readonly number[])[position] ?? null]],
        ),
      ),
  };
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
