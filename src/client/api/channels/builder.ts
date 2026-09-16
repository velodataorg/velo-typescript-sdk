import type { ChannelInput, DescriptorOf } from "../../../channel/channel.ts";
import type { WatchBuilder, WatchRequest } from "../../watch/registry.ts";
import { ChannelsParams } from "./params.ts";

/** An immutable channel-subscription request builder. */
export class ChannelsSubscribeBuilder<Input extends ChannelInput> implements WatchBuilder<
  "channels.subscribe",
  ChannelsParams<DescriptorOf<Input>>
> {
  readonly #request: WatchRequest<"channels.subscribe", ChannelsParams<DescriptorOf<Input>>>;

  constructor(inputs: readonly Input[]) {
    this.#request = Object.freeze({
      kind: "channels.subscribe",
      params: ChannelsParams.parse({ channels: inputs }),
    });
  }

  /** Returns the immutable transport-independent subscription request. */
  build(): WatchRequest<"channels.subscribe", ChannelsParams<DescriptorOf<Input>>> {
    return this.#request;
  }
}
