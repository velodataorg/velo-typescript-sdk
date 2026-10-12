import { VeloError } from "../../../errors.ts";
import { frameText } from "../../../transport/frame.ts";
import type { ChannelError, ChannelFrame } from "../../channel/channel.ts";

export type DecodedFrame =
  | { readonly type: "data"; readonly frame: ChannelFrame }
  | { readonly type: "channelError"; readonly error: ChannelError }
  | { readonly type: "heartbeat" }
  | { readonly type: "control" };

/**
 * Decodes one channel-socket frame into its typed message.
 *
 * @remarks
 * Frames are disambiguated by their marker field. `u2` is the server
 * rejecting a channel it does not know, the one answer it gives to a
 * subscription. `err` is read the same way and `s2`, an acknowledgement, is
 * ignored: the server sends neither, and a frame that is not understood
 * fails the connection. `hb` or `heartbeat` without a channel is the
 * liveness signal. Anything else must carry a channel name in `c` to be data.
 *
 * @param data - The frame's raw data from the session.
 * @returns The decoded frame.
 * @throws A VeloError when the frame is not JSON text, not an object, or a
 * data frame with malformed fields.
 */
export function decodeChannelFrame(data: unknown): DecodedFrame {
  let value: unknown;
  try {
    value = JSON.parse(frameText(data));
  } catch {
    throw new VeloError("unexpected channel message: expected JSON text");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new VeloError("unexpected channel message: expected an object");
  }
  const message = value as Record<string, unknown>;
  if (typeof message.u2 === "string") {
    return { type: "channelError", error: { channel: message.u2, reason: "rejected" } };
  }
  if (typeof message.err === "string") {
    return { type: "channelError", error: { channel: message.err, reason: "rejected" } };
  }
  if (typeof message.s2 === "string") return { type: "control" };
  if (message.c === undefined && (message.heartbeat === true || message.hb === 1)) {
    return { type: "heartbeat" };
  }
  if (
    typeof message.c !== "string" ||
    (message.tt !== undefined &&
      (typeof message.tt !== "number" || !Number.isFinite(message.tt))) ||
    (message.f !== undefined && typeof message.f !== "boolean")
  ) {
    throw new VeloError("unexpected channel message: invalid frame");
  }
  return { type: "data", frame: message as ChannelFrame };
}
