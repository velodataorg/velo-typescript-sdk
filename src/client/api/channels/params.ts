import {
  channel,
  validateChannelName,
  type ChannelDescriptor,
  type ChannelEnvelope,
  type ChannelInput,
  type DescriptorOf,
} from "../../../channel/channel.ts";
import { assert } from "../../../util/assert.ts";

/** Parameters for a channel subscription. */
export interface ChannelsParams<Input extends ChannelInput = ChannelInput> {
  /* Wire names and/or descriptors; a bare name subscribes as a raw channel. */
  readonly channels: readonly Input[];
}

export const ChannelsParams = Object.freeze({
  /**
   * Validates and snapshots channel-subscription parameters.
   *
   * @remarks
   * Each input becomes a frozen descriptor whose kind, name, and decoder are
   * captured now, so later mutation of a caller's descriptor cannot change
   * what a subscription does. Repeats of one wire name collapse when they
   * agree on kind and decoder and are rejected when they do not, since the
   * subscription would otherwise have to pick one silently.
   *
   * @param params - The caller's parameters.
   * @returns Frozen parameters with every input as a descriptor.
   * @throws A VeloError when the inputs are not a non-empty array of valid
   * names or descriptors, or when two of them conflict.
   */
  parse<Input extends ChannelInput>(
    params: ChannelsParams<Input>,
  ): ChannelsParams<DescriptorOf<Input>> {
    assert(
      params !== null && typeof params === "object" && !Array.isArray(params),
      "channels params must be an object",
    );
    const { channels: inputs } = params;
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

    /* Normalization keeps each descriptor's kind/data pair; strings became RawChannel. */
    return Object.freeze({ channels: Object.freeze(descriptors) }) as ChannelsParams<
      DescriptorOf<Input>
    >;
  },
});
