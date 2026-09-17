import { z } from "zod";

import { VeloError } from "../../errors.ts";
import { assert } from "../../util/assert.ts";
import type { Row, RowBase, RowColumns } from "../data/row.ts";
import type { Exchange } from "../market/exchanges.ts";
import type { Product } from "../market/product.ts";
import type { Channel, ChannelFrame } from "./channel.ts";
import { productChannelName } from "./name.ts";

/*
 * Everything that depends on a channel's scope. A scope is both the first
 * argument to `defineChannel` and the key here, so adding a scope adds one
 * entry rather than a new family of types.
 */
interface Scopes<E extends Exchange> {
  /* One product on one exchange, named `realtime_<exchange>:<product>` plus the suffix. */
  readonly product: {
    /*
     * A catalog product, exactly as returned. `coin` is not sent to the
     * server: frames carry none, so rows take it from here.
     */
    readonly params: Product<E>;
    readonly definition: {
      /* The exchanges that publish this kind; others are rejected when building. */
      readonly exchanges: readonly E[];
    };
  };
}

/** What channels of a kind are scoped to. */
export type ChannelScope = keyof Scopes<Exchange>;

/** The params a channel of the given scope is built from. */
export type ChannelParams<
  S extends ChannelScope,
  E extends Exchange = Exchange,
> = Scopes<E>[S]["params"];

/**
 * Everything that distinguishes one kind of channel from another: the fields
 * every scope shares, plus the ones only scope `S` has.
 */
type ChannelDefinition<
  S extends ChannelScope,
  Kind extends string,
  X extends Exchange,
  Frame,
  Data,
> = Scopes<X>[S]["definition"] & {
  readonly kind: Kind;
  /* Appended to the scope's name to select the indicator. Omitted for price. */
  readonly suffix?: string;
  /* What the server sends for this kind; a frame that fails it fails the connection. */
  readonly schema: z.ZodType<Frame>;
  /** Shapes one validated frame into what listeners receive. */
  readonly decode: (frame: Frame, params: ChannelParams<S, X>) => Data;
};

/**
 * Defines a kind of channel.
 *
 * @remarks
 * The scope decides what a channel of this kind is built from and how it is
 * named on the wire; the definition supplies only what differs between kinds
 * of that scope. A product-scoped kind subscribes to one product on one
 * exchange and delivers one row per frame.
 *
 * @param scope - What channels of this kind are scoped to.
 * @param definition - The kind, its exchanges and suffix, its frame schema,
 * and its decoder.
 * @returns A builder from params to a frozen channel of this kind.
 */
export function defineChannel<
  Kind extends string,
  X extends Exchange,
  Frame,
  Data extends RowBase<X>,
>(
  scope: "product",
  definition: ChannelDefinition<"product", Kind, X, Frame, Data>,
): <E extends X>(params: ChannelParams<"product", E>) => Channel<Kind, Row<E, RowColumns<Data>>> {
  assert(scope === "product", () => `unknown channel scope ${JSON.stringify(scope)}`);
  return defineProductChannel(definition);
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
 * @param params - The product the channel subscribes to.
 * @param tickTime - The frame's `tt`, in milliseconds.
 * @returns The exchange, coin, product, and bucket start.
 */
export function rowBase<E extends Exchange>(
  params: ChannelParams<"product", E>,
  tickTime: number,
): RowBase<E> {
  return {
    exchange: params.exchange,
    coin: params.coin,
    product: params.product,
    time: Math.floor(tickTime / MINUTE_MS) * MINUTE_MS,
  };
}

/**
 * Builds the product scope's channel builder.
 *
 * @remarks
 * Shared across every product-scoped kind: the params validation and
 * snapshot, the wire name, the frame check and its error context, and
 * freezing the result. The returned builder narrows the row's exchange to
 * the one it was called with.
 *
 * @param definition - What distinguishes the kind.
 * @returns A builder from params to a frozen channel of this kind.
 */
function defineProductChannel<
  Kind extends string,
  X extends Exchange,
  Frame,
  Data extends RowBase<X>,
>(
  definition: ChannelDefinition<"product", Kind, X, Frame, Data>,
): <E extends X>(params: ChannelParams<"product", E>) => Channel<Kind, Row<E, RowColumns<Data>>> {
  const { kind, exchanges, suffix, schema, decode } = definition;

  return <E extends X>(input: ChannelParams<"product", E>) => {
    const params = parseProductParams(kind, exchanges, input);
    const name = productChannelName(params.exchange, params.product, suffix);

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
        /* The row's exchange is the one in `params`, which is `E`. */
        return decode(parsed.data, params) as unknown as Row<E, RowColumns<Data>>;
      },
    });
  };
}

/**
 * Validates and snapshots the params of a product-scoped channel.
 *
 * @param kind - The kind being built, for error context.
 * @param exchanges - The exchanges the kind allows.
 * @param input - The caller's params; extra fields, as on a catalog row, are dropped.
 * @returns Frozen params holding only the three fields.
 * @throws A VeloError when the exchange is not allowed or a field is not usable.
 */
function parseProductParams<E extends Exchange>(
  kind: string,
  exchanges: readonly Exchange[],
  input: ChannelParams<"product", E>,
): ChannelParams<"product", E> {
  assert(
    input !== null && typeof input === "object" && !Array.isArray(input),
    () => `${kind} channel params must be an object`,
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
