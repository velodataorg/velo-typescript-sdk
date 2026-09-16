import { VeloError } from "../errors.ts";

const TEXT_DECODER = new TextDecoder();

/** Extracts text from native WebSocket frames and Node Buffers. */
export function frameText(data: unknown): string {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return TEXT_DECODER.decode(data);
  if (ArrayBuffer.isView(data)) {
    return TEXT_DECODER.decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }
  throw new VeloError("unexpected WebSocket message data: expected text");
}
