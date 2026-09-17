import type { Channel } from "../../channel/channel.ts";
import { ChannelsFeedBuilder } from "./builder.ts";

/** The channels namespace exposed by {@link Velo}. */
export class Channels {
  /**
   * Creates an immutable live-feed builder for a set of channels.
   *
   * @param channels - Channels built with the `channel` namespace. A bare
   * wire name goes through `channel.raw()`.
   * @returns A builder whose request carries the channels' types.
   */
  feed<const C extends Channel>(channels: readonly C[]): ChannelsFeedBuilder<C> {
    return new ChannelsFeedBuilder(channels);
  }
}
