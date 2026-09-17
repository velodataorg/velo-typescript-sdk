import { assert } from "../../../util/assert.ts";
import {
  type Channel,
  type ChannelFrame,
  type ChannelInput,
  type ChannelOf,
} from "../../channel/channel.ts";
import { raw } from "../../channel/kinds/raw.ts";
import { validateChannelName } from "../../channel/name.ts";

/** Parameters for a channel feed. */
export interface ChannelsParams<Input extends ChannelInput = ChannelInput> {
  /* Wire names and/or channels; a bare name subscribes as a raw channel. */
  readonly channels: readonly Input[];
}

export const ChannelsParams = Object.freeze({
  /**
   * Validates and snapshots channel-feed parameters.
   *
   * @remarks
   * Each input becomes a frozen channel whose kind, wire name, and decoder
   * are captured now, so later mutation of a caller's object cannot change
   * what a feed does. One wire name appears once: repeats with the same kind
   * collapse to the first, since a kind means one decoder, and repeats with
   * a different kind are rejected rather than picking one silently.
   *
   * @param params - The caller's parameters.
   * @returns Frozen parameters with every input as a channel.
   * @throws A VeloError when the inputs are not a non-empty array of valid
   * names or channels, or when two of them disagree on a kind.
   */
  parse<Input extends ChannelInput>(
    params: ChannelsParams<Input>,
  ): ChannelsParams<ChannelOf<Input>> {
    assert(
      params !== null && typeof params === "object" && !Array.isArray(params),
      "channels params must be an object",
    );
    const { channels: inputs } = params;
    assert(Array.isArray(inputs) && inputs.length > 0, "channels must be a non-empty array");

    const kinds = new Map<string, string>();
    const channels: Channel[] = [];
    for (const input of inputs) {
      const candidate = typeof input === "string" ? raw(input) : input;
      assert(
        candidate !== null &&
          typeof candidate === "object" &&
          typeof candidate.kind === "string" &&
          candidate.kind.length > 0 &&
          typeof candidate.name === "string" &&
          typeof candidate.decode === "function",
        "channels must contain strings or channels",
      );
      const name = candidate.name;
      validateChannelName(name);
      const previous = kinds.get(name);
      if (previous !== undefined) {
        assert(
          previous === candidate.kind,
          `conflicting channels for ${name}: ${previous} and ${candidate.kind}`,
        );
        continue;
      }
      kinds.set(name, candidate.kind);
      const decode = candidate.decode;
      channels.push(
        Object.freeze({
          kind: candidate.kind,
          name,
          decode: (frame: ChannelFrame) => decode.call(candidate, frame),
        }),
      );
    }

    /* Normalization keeps each channel's kind/data pair; strings became RawChannel. */
    return Object.freeze({ channels: Object.freeze(channels) }) as ChannelsParams<ChannelOf<Input>>;
  },
});
