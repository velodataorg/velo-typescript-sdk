import type { ChannelInput } from "../../../channel/channel.ts";
import { ChannelsFeedBuilder } from "./builder.ts";

/** The channels namespace exposed by {@link Velo}. */
export class Channels {
  /**
   * Creates an immutable live-feed builder for a set of channels.
   *
   * @param inputs - Wire names and/or descriptors; a bare name subscribes raw.
   * @returns A builder whose request carries the descriptors' types.
   */
  feed<const Input extends ChannelInput>(inputs: readonly Input[]): ChannelsFeedBuilder<Input> {
    return new ChannelsFeedBuilder(inputs);
  }
}
