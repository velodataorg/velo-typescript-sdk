import { parseFiniteNumber } from "../../decode/csv.ts";
import type { LineDecoder } from "../../decode/lines.ts";
import { MAX_TIMESTAMP_MS } from "../../validation.ts";
import type { OrderbookRow } from "./data.ts";

/**
 * Builds the line decoder of an orderbook levels response.
 *
 * @remarks
 * The body is not header-first CSV: the first line carries the price-grid
 * step, and every following line is one bucket of
 * `time,mid,price,size,price,size,...` cells with a variable number of level
 * pairs. Cells are validated positionally instead of through a Zod object
 * because rows have no column names and are hundreds of cells wide. A blank
 * line carries nothing, and a CRLF body is read as LF. Make one decoder per
 * response, since it remembers the step.
 *
 * @returns The line decoder, which yields one row per bucket, each carrying
 * the response's grid step, and throws if the step line, a row's cell count,
 * or any cell is malformed.
 */
export function orderbookRows(): LineDecoder<OrderbookRow> {
  let step: number | undefined;
  let lineNumber = 0;

  return (raw) => {
    const line = stripReturn(raw);
    lineNumber++;
    if (line === "") return undefined;

    if (step === undefined) {
      step = parseFiniteNumber(line);
      if (step === undefined || step <= 0) {
        throw new Error(`Line 1 ${JSON.stringify(raw)} is not a positive price-grid step`);
      }
      return undefined;
    }
    return decodeRow(line, lineNumber, step);
  };
}

/**
 * Decodes one bucket line into a columnar row.
 *
 * @param line - The raw line without its newline.
 * @param lineNumber - The 1-based body line number, for error messages.
 * @param step - The price-grid step from the body's first line.
 * @returns The decoded row.
 * @throws If the cell count is odd or below two, or any cell is malformed.
 */
function decodeRow(line: string, lineNumber: number, step: number): OrderbookRow {
  const cells = line.split(",");
  if (cells.length < 2 || cells.length % 2 !== 0) {
    throw new Error(
      `Line ${lineNumber} has ${cells.length} cells, expected an even count of at least 2`,
    );
  }

  const time = parseFiniteNumber(cells[0]!);
  if (time === undefined || !Number.isInteger(time) || time < 0 || time > MAX_TIMESTAMP_MS) {
    throw new Error(
      `Line ${lineNumber} time ${JSON.stringify(cells[0])} is not a millisecond timestamp`,
    );
  }

  const mid = parseFiniteNumber(cells[1]!);
  if (mid === undefined || mid <= 0) {
    throw new Error(`Line ${lineNumber} mid ${JSON.stringify(cells[1])} is not a positive price`);
  }

  const count = (cells.length - 2) / 2;
  const prices = new Float64Array(count);
  const sizes = new Float64Array(count);

  for (let level = 0; level < count; level++) {
    const rawPrice = cells[2 + level * 2]!;
    const rawSize = cells[3 + level * 2]!;

    const price = parseFiniteNumber(rawPrice);
    if (price === undefined || price <= 0) {
      throw new Error(
        `Line ${lineNumber} level ${level} price ${JSON.stringify(rawPrice)} is not a positive ` +
          `price`,
      );
    }
    if (level > 0 && price <= prices[level - 1]!) {
      throw new Error(
        `Line ${lineNumber} level prices are not ascending: ${price} after ${prices[level - 1]}`,
      );
    }

    const size = parseFiniteNumber(rawSize);
    if (size === undefined || size < 0) {
      throw new Error(
        `Line ${lineNumber} level ${level} size ${JSON.stringify(rawSize)} is not a ` +
          `non-negative number`,
      );
    }

    prices[level] = price;
    sizes[level] = size;
  }

  return { time, mid, step, prices, sizes };
}

/**
 * Removes one trailing carriage return, left by splitting a CRLF body.
 *
 * @param line - One line of the body.
 * @returns The line without a trailing carriage return.
 */
function stripReturn(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}
