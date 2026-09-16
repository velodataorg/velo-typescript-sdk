import type { ChannelInput } from "../../../channel/channel.ts";
import { ChannelsSubscribeBuilder } from "./builder.ts";

/** The channels namespace exposed by {@link Velo}. */
export class Channels {
  /**
   * Creates an immutable subscription builder for a set of channels.
   *
   * @param inputs - Wire names and/or descriptors; a bare name subscribes raw.
   * @returns A builder whose request carries the descriptors' types.
   */
  subscribe<const Input extends ChannelInput>(
    inputs: readonly Input[],
  ): ChannelsSubscribeBuilder<Input> {
    return new ChannelsSubscribeBuilder(inputs);
  }
}
