import type { ChannelEnvelope } from "../../../channel/channel.ts";
import { VeloError } from "../../../errors.ts";
import { frameText } from "../../../transport/frame.ts";

export interface ChannelError {
  readonly channel: string;
  readonly reason: "rejected" | "unsubscribed";
}

type ChannelFrame =
  | { type: "data"; message: ChannelEnvelope }
  | { type: "channelError"; error: ChannelError }
  | { type: "control" };

export function decodeChannelFrame(data: unknown): ChannelFrame {
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
  if (
    typeof message.s2 === "string" ||
    (message.c === undefined && (message.heartbeat === true || message.hb === 1))
  )
    return { type: "control" };
  if (
    typeof message.c !== "string" ||
    (message.tt !== undefined &&
      (typeof message.tt !== "number" || !Number.isFinite(message.tt))) ||
    (message.f !== undefined && typeof message.f !== "boolean")
  ) {
    throw new VeloError("unexpected channel message: invalid envelope");
  }
  return { type: "data", message: message as ChannelEnvelope };
}
