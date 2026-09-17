import type { Channel } from "../../channel/channel.ts";
import type { WatchBuilder, WatchRequest } from "../../watch/registry.ts";
import { ChannelsParams } from "./params.ts";

/** An immutable live-channel feed builder. */
export class ChannelsFeedBuilder<C extends Channel> implements WatchBuilder<
  "channels.feed",
  ChannelsParams<C>
> {
  readonly #request: WatchRequest<"channels.feed", ChannelsParams<C>>;

  constructor(channels: readonly C[]) {
    this.#request = Object.freeze({
      kind: "channels.feed",
      params: ChannelsParams.parse({ channels }),
    });
  }

  /** Returns the immutable transport-independent subscription request. */
  build(): WatchRequest<"channels.feed", ChannelsParams<C>> {
    return this.#request;
  }
}
