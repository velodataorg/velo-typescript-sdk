import { z } from "zod";

import { VeloError } from "../../errors.ts";
import { assert } from "../../util/assert.ts";
import type { Row, RowBase } from "../data/row.ts";
import type { Exchange } from "../market/exchanges.ts";
import type { Product } from "../market/product.ts";
import type { Channel, ChannelFrame } from "./channel.ts";
import { productChannelName } from "./name.ts";

/* What a kind's columns hold: one value per history column, null where there is none. */
type Columns = Readonly<Record<string, number | null>>;

/** Everything that distinguishes one product-scoped kind of channel from another. */
interface ProductDefinition<Kind extends string, X extends Exchange, Payload, C extends Columns> {
  readonly kind: Kind;
  /* The exchanges that publish this kind; others are rejected when building. */
  readonly exchanges: readonly X[];
  /* Appended to the product's name to select the indicator. Omitted for price. */
  readonly suffix?: string;
  /* What the server sends as `d`; a frame that fails it is reported and skipped. */
  readonly payload: z.ZodType<Payload>;
  /** Names one validated payload's values as the history columns they fill. */
  readonly columns: (payload: Payload) => C;
}

/**
 * Defines a kind of channel.
 *
 * @remarks
 * The scope decides what a channel of this kind is built from and how it is
 * named on the wire; the definition supplies only what differs between kinds
 * of that scope. Shared here are the product validation and snapshot, the
 * wire name, the frame check and its error context, the row every frame
 * becomes, and freezing the result.
 *
 * A product-scoped kind subscribes to one product on one exchange, named
 * `realtime_<exchange>:<product>` plus the suffix.
 *
 * @param scope - What channels of this kind are scoped to.
 * @param definition - The kind, its exchanges and suffix, its payload, and
 * the columns the payload fills.
 * @returns A builder from a product to a frozen channel whose data is a
 * history row of those columns.
 */
export function defineChannel<Kind extends string, X extends Exchange, Payload, C extends Columns>(
  scope: "product",
  definition: ProductDefinition<Kind, X, Payload, C>,
): (product: Product<X>) => Channel<Kind, Row<X, keyof C & string>> {
  assert(scope === "product", () => `unknown channel scope ${JSON.stringify(scope)}`);
  const { kind, exchanges, suffix, payload, columns } = definition;
  /* Every realtime frame carries its tick time beside the payload. */
  const schema = z.object({ d: payload, tt: z.number() });

  return (input) => {
    const product = parseProduct(kind, exchanges, input);
    const name = productChannelName(product.exchange, product.product, suffix);

    return Object.freeze({
      kind,
      name,
      decode: (frame: ChannelFrame) => {
        const parsed = schema.safeParse(frame);
        if (!parsed.success) {
          throw new VeloError(`unexpected ${name} message:\n${z.prettifyError(parsed.error)}`, {
            cause: parsed.error,
          });
        }
        const { d, tt } = parsed.data;
        return { ...rowBase(product, tt), ...columns(d as Payload) } as Row<X, keyof C & string>;
      },
    });
  };
}

const MINUTE_MS = 60_000;

/**
 * The fields every row starts with, for a frame of a product-scoped channel.
 *
 * @remarks
 * Realtime frames describe the one-minute bucket in progress, and history
 * rows are timed at the start of their bucket, so the tick time is floored
 * to the minute to make the two line up.
 *
 * @param product - The product the channel subscribes to.
 * @param tickTime - The frame's `tt`, in milliseconds.
 * @returns The exchange, coin, product, and bucket start.
 */
function rowBase<E extends Exchange>(product: Product<E>, tickTime: number): RowBase<E> {
  return {
    exchange: product.exchange,
    coin: product.coin,
    product: product.product,
    time: Math.floor(tickTime / MINUTE_MS) * MINUTE_MS,
  };
}

/**
 * Validates and snapshots the product a channel is built from.
 *
 * @param kind - The kind being built, for error context.
 * @param exchanges - The exchanges the kind allows.
 * @param input - The caller's product; extra fields, as on a catalog row, are dropped.
 * @returns A frozen product holding only the three fields.
 * @throws A VeloError when the exchange is not allowed or a field is not usable.
 */
function parseProduct<X extends Exchange>(
  kind: string,
  exchanges: readonly X[],
  input: Product<X>,
): Product<X> {
  assert(
    input !== null && typeof input === "object" && !Array.isArray(input),
    () => `${kind} channel product must be an object`,
  );
  const { exchange, coin, product } = input;
  assert(
    exchanges.includes(exchange),
    () => `invalid exchange ${JSON.stringify(exchange)} for a ${kind} channel`,
  );
  assert(typeof coin === "string" && coin.length > 0, "coin must be a non-empty string");
  assert(typeof product === "string" && product.length > 0, "product must be a non-empty string");
  return Object.freeze({ exchange, coin, product });
}
