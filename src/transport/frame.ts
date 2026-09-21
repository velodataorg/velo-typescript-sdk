import { VeloError } from "../errors.ts";

const TEXT_DECODER = new TextDecoder();

/**
 * Extracts the text of one WebSocket frame.
 *
 * @param data - A frame's `data` in any shape the socket layer may deliver:
 * a string, an ArrayBuffer, or an ArrayBuffer view such as a Node Buffer.
 * @returns The frame payload as text.
 * @throws A VeloError when `data` is not a recognized text carrier.
 */
export function frameText(data: unknown): string {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return TEXT_DECODER.decode(data);
  if (ArrayBuffer.isView(data)) {
    return TEXT_DECODER.decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }
  throw new VeloError(
    `unexpected WebSocket message data: expected text, got ${Object.prototype.toString.call(data)}`,
  );
}
