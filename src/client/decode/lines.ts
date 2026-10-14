import { VeloError } from "../../errors.ts";

/*
 * Reads one line of a response body into a row, or into undefined for a line
 * that carries none, such as a header or a blank line. Made fresh for each
 * response, since it may remember what earlier lines said.
 */
export type LineDecoder<T> = (line: string) => T | undefined;

/**
 * Decodes a response body line by line, labelling what the decoder refuses.
 *
 * @remarks
 * Only a line the decoder refuses is reported as a malformed response. A
 * failure reading the lines themselves, such as the caller aborting, a
 * timeout, or a dropped connection, passes through as the transport typed it.
 *
 * @param lines - The response body's lines, as the transport reads them.
 * @param decodeLine - Reads one line; it throws for a line that does not fit.
 * @param path - The endpoint path, naming the response in the error.
 * @returns The decoded rows, in response order.
 * @throws A VeloError, "Unexpected <path> response", for a line the decoder
 * refuses; its cause is the decoder's error.
 */
export async function* decodeLines<T>(
  lines: AsyncIterable<string>,
  decodeLine: LineDecoder<T>,
  path: string,
): AsyncGenerator<T> {
  for await (const line of lines) {
    let row: T | undefined;
    try {
      row = decodeLine(line);
    } catch (cause) {
      throw new VeloError(`Unexpected ${path} response`, { cause });
    }
    if (row !== undefined) yield row;
  }
}
