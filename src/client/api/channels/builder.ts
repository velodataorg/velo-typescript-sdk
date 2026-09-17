import type { ChannelInput, ChannelOf } from "../../channel/channel.ts";
import type { WatchBuilder, WatchRequest } from "../../watch/registry.ts";
import { ChannelsParams } from "./params.ts";

/** An immutable live-channel feed builder. */
export class ChannelsFeedBuilder<Input extends ChannelInput> implements WatchBuilder<
  "channels.feed",
  ChannelsParams<ChannelOf<Input>>
> {
  readonly #request: WatchRequest<"channels.feed", ChannelsParams<ChannelOf<Input>>>;

  constructor(inputs: readonly Input[]) {
    this.#request = Object.freeze({
      kind: "channels.feed",
      params: ChannelsParams.parse({ channels: inputs }),
    });
  }

  /** Returns the immutable transport-independent subscription request. */
  build(): WatchRequest<"channels.feed", ChannelsParams<ChannelOf<Input>>> {
    return this.#request;
  }
}
