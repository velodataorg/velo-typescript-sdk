import {
  channel,
  validateChannelName,
  type ChannelDescriptor,
  type ChannelEnvelope,
  type ChannelInput,
  type DescriptorOf,
} from "../../../channel/channel.ts";
import { assert } from "../../../util/assert.ts";
import type { WatchBuilder, WatchRequest } from "../../watch/registry.ts";

export interface ChannelsParams<Input extends ChannelInput = ChannelInput> {
  readonly channels: readonly Input[];
}

/** Groups raw names and channel descriptors. Execution belongs to velo.watch(). */
export class Channels {
  subscribe<const Input extends ChannelInput>(
    inputs: readonly Input[],
  ): WatchBuilder<"channels.subscribe", ChannelsParams<DescriptorOf<Input>>> {
    const request: WatchRequest<
      "channels.subscribe",
      ChannelsParams<DescriptorOf<Input>>
    > = Object.freeze({
      kind: "channels.subscribe",
      params: this.#prepare(inputs),
    });
    return Object.freeze({ build: () => request });
  }

  /** Validates and snapshots channel inputs before describing a subscription. */
  #prepare<Input extends ChannelInput>(
    inputs: readonly Input[],
  ): ChannelsParams<DescriptorOf<Input>> {
    assert(Array.isArray(inputs) && inputs.length > 0, "channels must be a non-empty array");
    const originals = new Map<string, ChannelDescriptor>();
    const descriptors: ChannelDescriptor[] = [];
    for (const input of inputs) {
      const descriptor = typeof input === "string" ? channel.raw(input) : input;
      assert(
        descriptor !== null &&
          typeof descriptor === "object" &&
          typeof descriptor.kind === "string" &&
          descriptor.kind.length > 0 &&
          typeof descriptor.channel === "function" &&
          typeof descriptor.decode === "function",
        "channels must contain strings or channel descriptors",
      );
      const name = descriptor.channel();
      validateChannelName(name);
      const previous = originals.get(name);
      if (previous) {
        assert(
          previous.kind === descriptor.kind && previous.decode === descriptor.decode,
          `conflicting descriptors for channel ${name}`,
        );
        continue;
      }
      originals.set(name, descriptor);
      const decode = descriptor.decode;
      descriptors.push(
        Object.freeze({
          kind: descriptor.kind,
          channel: () => name,
          decode: (message: ChannelEnvelope) => decode.call(descriptor, message),
        }),
      );
    }
    // Normalization preserves each descriptor's kind/data pair; strings become RawChannel.
    return Object.freeze({ channels: Object.freeze(descriptors) }) as ChannelsParams<
      DescriptorOf<Input>
    >;
  }
}
