import type { ChannelFrame, RawChannel } from "../channel.ts";
import { validateChannelName } from "../name.ts";

/**
 * Describes a channel by its wire name alone.
 *
 * @remarks
 * A raw name is never interpreted as a typed channel, even when its format
 * is recognized; the payload is delivered as `unknown`.
 *
 * @param name - The wire name to subscribe with.
 * @returns A frozen raw channel.
 * @throws A VeloError when `name` is not a valid channel name.
 */
export function raw(name: string): RawChannel {
  validateChannelName(name);
  return Object.freeze({ kind: "raw", name, decode: decodeRaw });
}

/**
 * The raw decoder: the frame's `d` field, untouched.
 *
 * @param frame - A frame from the server.
 * @returns The payload, or undefined for channels that put their fields at
 * the top level of the frame.
 */
function decodeRaw(frame: ChannelFrame): unknown {
  return frame.d;
}
