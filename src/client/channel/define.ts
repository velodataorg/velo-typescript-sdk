import { z } from "zod";

import { VeloError } from "../../errors.ts";
import { assert } from "../../util/assert.ts";
import type { RowBase } from "../data/row.ts";
import type { Exchange } from "../market/exchanges.ts";
import type { Product } from "../market/product.ts";
import type { Channel, ChannelFrame } from "./channel.ts";
import { productChannelName } from "./name.ts";

/** Everything that distinguishes one product-scoped kind of channel from another. */
interface ProductDefinition<Kind extends string, X extends Exchange, Frame, Data> {
  readonly kind: Kind;
  /* The exchanges that publish this kind; others are rejected when building. */
  readonly exchanges: readonly X[];
  /* Appended to the product's name to select the indicator. Omitted for price. */
  readonly suffix?: string;
  /* What the server sends for this kind; a frame that fails it is reported and skipped. */
  readonly schema: z.ZodType<Frame>;
  /** Shapes one validated frame into what listeners receive. */
  readonly decode: (frame: Frame, product: Product<X>) => Data;
}

/**
 * Defines a kind of channel.
 *
 * @remarks
 * The scope decides what a channel of this kind is built from and how it is
 * named on the wire; the definition supplies only what differs between kinds
 * of that scope. Shared here are the product validation and snapshot, the
 * wire name, the frame check and its error context, and freezing the result.
 *
 * A product-scoped kind subscribes to one product on one exchange, named
 * `realtime_<exchange>:<product>` plus the suffix.
 *
 * @param scope - What channels of this kind are scoped to.
 * @param definition - The kind, its exchanges and suffix, its frame schema,
 * and its decoder.
 * @returns A builder from a product to a frozen channel of this kind.
 */
export function defineChannel<Kind extends string, X extends Exchange, Frame, Data>(
  scope: "product",
  definition: ProductDefinition<Kind, X, Frame, Data>,
): (product: Product<X>) => Channel<Kind, Data> {
  assert(scope === "product", () => `unknown channel scope ${JSON.stringify(scope)}`);
  const { kind, exchanges, suffix, schema, decode } = definition;

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
        return decode(parsed.data, product);
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
export function rowBase<E extends Exchange>(product: Product<E>, tickTime: number): RowBase<E> {
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
