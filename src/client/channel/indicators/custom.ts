import { assert } from "../../../util/assert.ts";
import { isRecord } from "../../../util/object.ts";
import { isNonEmptyString } from "../../../util/string.ts";
import type { Channel, ChannelFrame, CustomChannel } from "../channel.ts";
import { createChannel } from "../create.ts";
import { validateChannelName } from "../name.ts";

const INDICATOR = "channels.custom";

/**
 * Builds a channel with a decoder of the caller's own.
 *
 * @remarks
 * For a wire name no builder covers, read the caller's way. The kind, the
 * name, and the decoder are captured now, so changing the object passed in
 * afterwards changes nothing. A kind means one decoder: keep a kind of your
 * own apart from the built-in ones.
 *
 * @param definition - The kind that names how the frames are read, the wire
 * name to subscribe with, and the decoder each frame goes through. The decoder is
 * synchronous and throws for a frame it cannot read.
 * @returns The frozen channel.
 * @throws A VeloError when a field is not usable.
 */
export function custom<const Kind extends string, Data>(
  definition: CustomChannel<Kind, Data>,
): Channel<Kind, Data> {
  assert(isRecord(definition), `${INDICATOR}() takes an object of kind, name, and decode`);
  const { kind, name, decode } = definition;
  assert(isNonEmptyString(kind), `${INDICATOR}() takes a kind that is a non-empty string`);
  assert(typeof name === "string", `${INDICATOR}() takes a name that is a string`);
  validateChannelName(name);
  assert(typeof decode === "function", `${INDICATOR}() takes a decode that is a function`);

  /* Called on the caller's object, as it was written, in case the decoder reads `this`. */
  return createChannel({
    kind,
    name,
    decode: (frame: ChannelFrame) => decode.call(definition, frame),
  });
}
