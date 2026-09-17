/** One frame as the server sent it, available unmodified on every delivered message. */
export interface ChannelFrame {
  readonly c: string;
  readonly d?: unknown;
  readonly tt?: number;
  readonly f?: boolean;
  readonly [field: string]: unknown;
}

/**
 * One channel a feed can carry: what to subscribe to and how to read it.
 *
 * Independent of any client or subscription, so the same value can go into
 * several feeds. Built-in kinds add fields describing what they subscribe
 * to; a custom channel needs only these three.
 */
export interface Channel<Kind extends string = string, Data = unknown> {
  /**
   * Names the interpretation of this channel's frames.
   *
   * A kind means one decoder: two channels with the same wire name and kind
   * are the same channel, and a feed keeps the first. Message listeners
   * narrow `data` on it.
   */
  readonly kind: Kind;
  /* The wire name sent to the server. */
  readonly name: string;
  /** Validates and decodes one frame, throwing if its payload is invalid. Synchronous. */
  decode(frame: ChannelFrame): Data;
}

export type RawChannel = Channel<"raw", unknown>;
export type ChannelInput = string | Channel;
export type ChannelOf<Input extends ChannelInput> = Input extends string
  ? RawChannel
  : Input extends Channel<infer Kind, infer Data>
    ? Channel<Kind, Data>
    : never;

/** Distributes over channels so checking kind narrows the associated data. */
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

export type RawChannelMessage = ChannelMessage<RawChannel>;
