import type { VeloError } from "../../errors.ts";

/** One frame as the server sent it, available unmodified on every delivered message. */
export interface ChannelFrame {
  readonly c: string;
  readonly d?: unknown;
  readonly tt?: number;
  readonly f?: boolean;
  readonly [field: string]: unknown;
}

/**
 * One channel a feed can carry: what to subscribe to, how to read it, and who
 * listens to it.
 *
 * Independent of any client or subscription, so the same value can go into
 * several feeds, and its listeners go with it. Every channel is built on the
 * `channels` namespace; one with a decoder of the caller's own is built with
 * `channels.custom()`.
 */
export interface Channel<Kind extends string = string, Data = unknown> {
  /**
   * Names the interpretation of this channel's frames.
   *
   * A kind means one decoder: two channels with the same wire name and kind
   * are the same subscription, decoded once, and each one's listeners are
   * called.
   */
  readonly kind: Kind;
  /* The wire name sent to the server. */
  readonly name: string;
  /** Validates and decodes one frame, throwing if its payload is invalid. Synchronous. */
  decode(frame: ChannelFrame): Data;
  /**
   * Attaches listeners, typed by this channel alone.
   *
   * @param listeners - What to call with this channel's data and errors.
   * @returns A new frozen channel carrying them; this one is unchanged.
   * @throws A VeloError when a listener is not a function, is not one a
   * channel has, or is already attached.
   */
  on(listeners: ChannelListeners<Kind, Data>): Channel<Kind, Data>;
}

/*
 * What a channel calls. Written as methods so a channel of one kind still
 * passes where any channel is accepted: a listener's parameter is then
 * compared both ways.
 */
export interface ChannelListeners<Kind extends string = string, Data = unknown> {
  /**
   * Called with each frame's decoded data.
   *
   * @param data - A history row for a product's channel, or one entry per
   * exchange for a coin's.
   * @param message - The data with where it came from: the kind, the wire
   * name, the tick time, and the frame as the server sent it.
   */
  data?(data: Data, message: ChannelMessage<Channel<Kind, Data>>): void;
  /**
   * Called when something goes wrong on this channel alone; the rest of the
   * feed continues.
   *
   * @param event - What went wrong. Only `decode` leaves the channel
   * delivering; with any other reason it is not.
   */
  error?(event: ChannelError): void;
}

/* What `channels.custom()` takes: a channel with a decoder of the caller's own. */
export interface CustomChannel<Kind extends string = string, Data = unknown> {
  readonly kind: Kind;
  readonly name: string;
  decode(frame: ChannelFrame): Data;
}

/* What `channels.raw()` builds: a wire name whose payload is left as `unknown`. */
export type RawChannel = Channel<"raw", unknown>;

/*
 * Something that went wrong on one channel while the rest of the feed
 * continues.
 *
 * `decode` is one frame the channel's decoder refused: the frame is skipped
 * and the channel carries on. Every other reason means the channel is not
 * delivering. `rejected` and `unsubscribed` are the server's doing, and last
 * until the next connection. `failing` is the client's: the channel's frames
 * kept failing to decode, so further failures stay quiet. Its subscription is
 * kept, and `data` resumes by itself once a frame decodes.
 */
export type ChannelError =
  | { readonly channel: string; readonly reason: "rejected" | "unsubscribed" }
  | {
      readonly channel: string;
      readonly reason: "decode";
      /* Its `cause` is the decoder's own error, such as the schema mismatch. */
      readonly error: VeloError;
      readonly frame: ChannelFrame;
    }
  | {
      readonly channel: string;
      readonly reason: "failing";
      /* The failure that reached the limit; its `cause` is the decoder's own error. */
      readonly error: VeloError;
    };

/*
 * What a channel's `data` listener gets beside the data: where it came from.
 * A listener shared by channels of several kinds tells them apart by `kind`.
 */
export type ChannelMessage<C extends Channel = Channel> =
  C extends Channel<infer Kind, infer Data>
    ? {
        readonly kind: Kind;
        readonly channel: string;
        readonly timestamp?: number;
        readonly data: Data;
        /** The unmodified frame, including server flags and any channel-specific fields. */
        readonly frame: ChannelFrame;
      }
    : never;
