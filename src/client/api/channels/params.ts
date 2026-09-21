import { assert } from "../../../util/assert.ts";
import type { Channel } from "../../channel/channel.ts";
import { isChannel, listenersOf } from "../../channel/create.ts";

/** Parameters for a channel feed. */
export interface ChannelsParams {
  /* Built on the `channels` namespace, each with a `data` listener from `on()`. */
  readonly channels: readonly Channel[];
}

export const ChannelsParams = Object.freeze({
  /**
   * Validates channel-feed parameters.
   *
   * @remarks
   * A channel is kept as the value the caller passed, which is already
   * frozen, so that value is what names it afterwards. The same value passed
   * twice is kept once. Two values with one wire name are both kept: they are
   * one subscription, and each one's listeners are called. A kind means one
   * decoder, so two that disagree on a kind are rejected rather than picking
   * one silently.
   *
   * @param params - The caller's parameters.
   * @returns Frozen parameters holding each distinct channel.
   * @throws A VeloError when the channels are not a non-empty array of
   * channels built on the `channels` namespace, when one has no `data`
   * listener and so would deliver nowhere, or when two disagree on a kind.
   */
  parse(params: ChannelsParams): ChannelsParams {
    assert(
      params !== null && typeof params === "object" && !Array.isArray(params),
      "channels params must be an object",
    );
    const { channels: inputs } = params;
    assert(Array.isArray(inputs) && inputs.length > 0, "channels must be a non-empty array");

    const kinds = new Map<string, string>();
    const channels: Channel[] = [];
    for (const input of inputs as readonly unknown[]) {
      const channel = parseChannel(input);
      const { kind, name } = channel;
      const previous = kinds.get(name);
      assert(
        previous === undefined || previous === kind,
        `conflicting channels for ${name}: ${previous} and ${kind}`,
      );
      kinds.set(name, kind);
      if (!channels.includes(channel)) channels.push(channel);
    }

    return Object.freeze({ channels: Object.freeze(channels) });
  },
});

/**
 * Checks that a value is a channel a feed can deliver.
 *
 * @param input - What a caller passed as a channel.
 * @returns The channel, as the value it is.
 * @throws A VeloError when it was not built on the `channels` namespace, or
 * has no `data` listener and so would deliver nowhere.
 */
export function parseChannel(input: unknown): Channel {
  assert(
    isChannel(input),
    "channels must be built on the channels namespace; wrap a wire name with channels.raw(), or a decoder of your own with channels.custom()",
  );
  assert(
    listenersOf(input).data !== undefined,
    `${input.name} has no data listener; give it one with .on({ data })`,
  );
  return input;
}
