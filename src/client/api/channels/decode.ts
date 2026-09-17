import { VeloError } from "../../../errors.ts";
import { frameText } from "../../../transport/frame.ts";
import type { ChannelFrame } from "../../channel/channel.ts";

export interface ChannelError {
  readonly channel: string;
  readonly reason: "rejected" | "unsubscribed";
}

export type DecodedFrame =
  | { readonly type: "data"; readonly frame: ChannelFrame }
  | { readonly type: "channelError"; readonly error: ChannelError }
  | { readonly type: "heartbeat" }
  | { readonly type: "control" };

/**
 * Decodes one channel-socket frame into its typed message.
 *
 * @remarks
 * Frames are disambiguated by their marker field. `err` and `u2` report one
 * channel the server dropped; `s2` acknowledges a subscription; `hb` or
 * `heartbeat` without a channel is the liveness signal. Anything else must
 * carry a channel name in `c` to be data.
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
  if (typeof message.err === "string") {
    return { type: "channelError", error: { channel: message.err, reason: "rejected" } };
  }
  if (typeof message.u2 === "string") {
    return { type: "channelError", error: { channel: message.u2, reason: "unsubscribed" } };
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
