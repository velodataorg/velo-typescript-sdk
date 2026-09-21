import { assert } from "../../../util/assert.ts";
import type { Channel, ChannelFrame } from "../../channel/channel.ts";
import { validateChannelName } from "../../channel/name.ts";

/** Parameters for a channel feed. */
export interface ChannelsParams<C extends Channel = Channel> {
  /* Built on the `channels` namespace; a bare wire name goes through `channels.raw()`. */
  readonly channels: readonly C[];
}

export const ChannelsParams = Object.freeze({
  /**
   * Validates and snapshots channel-feed parameters.
   *
   * @remarks
   * Each channel is copied and frozen with its kind, wire name, and decoder
   * captured now, so later mutation of a caller's object cannot change what
   * a feed does. One wire name appears once: repeats with the same kind
   * collapse to the first, since a kind means one decoder, and repeats with
   * a different kind are rejected rather than picking one silently.
   *
   * @param params - The caller's parameters.
   * @returns Frozen parameters holding a frozen copy of each distinct channel.
   * @throws A VeloError when the channels are not a non-empty array of valid
   * channels, or when two of them disagree on a kind.
   */
  parse<C extends Channel>(params: ChannelsParams<C>): ChannelsParams<C> {
    assert(
      params !== null && typeof params === "object" && !Array.isArray(params),
      "channels params must be an object",
    );
    const { channels: inputs } = params;
    assert(Array.isArray(inputs) && inputs.length > 0, "channels must be a non-empty array");

    const kinds = new Map<string, string>();
    const channels: C[] = [];
    for (const input of inputs as readonly C[]) {
      assert(
        input !== null &&
          typeof input === "object" &&
          typeof input.kind === "string" &&
          input.kind.length > 0 &&
          typeof input.name === "string" &&
          typeof input.decode === "function",
        "channels must be channel objects; wrap a wire name with channels.raw()",
      );
      const { kind, name, decode } = input;
      validateChannelName(name);
      const previous = kinds.get(name);
      if (previous !== undefined) {
        assert(previous === kind, `conflicting channels for ${name}: ${previous} and ${kind}`);
        continue;
      }
      kinds.set(name, kind);
      channels.push(
        Object.freeze({
          ...input,
          kind,
          name,
          decode: (frame: ChannelFrame) => decode.call(input, frame),
        }),
      );
    }

    return Object.freeze({ channels: Object.freeze(channels) });
  },
});
