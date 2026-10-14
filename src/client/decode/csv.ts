import { csvParseRows } from "d3-dsv";
import { z } from "zod";

import { timestamp } from "../validation.ts";
import type { LineDecoder } from "./lines.ts";

/**
 * Converts one CSV cell to a finite number.
 *
 * Trim-checks before converting because `Number()` turns empty and
 * whitespace-only strings into 0, which would fabricate data from a corrupt
 * cell.
 *
 * @param raw - The raw cell text.
 * @returns The finite number, or undefined when the cell is not one.
 */
export function parseFiniteNumber(raw: string): number | undefined {
  const value = Number(raw);
  return raw.trim() !== "" && Number.isFinite(value) ? value : undefined;
}

export const csvNumber = z.string().transform((raw, context) => {
  const value = parseFiniteNumber(raw);
  if (value !== undefined) return value;

  context.addIssue({
    code: "custom",
    message: "expected a finite number",
  });
  return z.NEVER;
});

export const csvTimestamp = csvNumber.pipe(timestamp);

export const csvBoolean = z.enum(["true", "false"]).transform((value) => value === "true");

/* Serializations of a missing value. The API interpolates row values with
 * `${value}`, so null, undefined, and NaN arrive as their exact JavaScript
 * string forms alongside the empty cell. Infinity is deliberately excluded:
 * it would signal a computed overflow rather than a missing value.
 */
const NULL_MARKERS = new Set(["", "null", "undefined", "NaN"]);

export const csvNumberOrNull = z.string().transform((raw, context) => {
  if (NULL_MARKERS.has(raw)) return null;

  const value = parseFiniteNumber(raw);
  if (value !== undefined) return value;

  context.addIssue({
    code: "custom",
    message: "expected a finite number or null",
  });
  return z.NEVER;
});

/**
 * Builds the line decoder of a header-first CSV response.
 *
 * @remarks
 * The first non-empty line must be the schema's keys, in the same order.
 * Every later one is a row with a cell for each key, validated by the
 * schema. A blank line carries nothing: the server ends its body with a
 * newline. Make one decoder per response, since it remembers whether the
 * header has been read.
 *
 * @param schema - The schema for one raw CSV row.
 * @returns The line decoder, which throws if the header, a row's cell count,
 * or any cell does not match the schema.
 */
export function csvRows<Schema extends z.ZodObject>(schema: Schema): LineDecoder<z.output<Schema>> {
  const expected = Object.keys(schema.shape);
  let index = 0;

  return (line) => {
    if (line.length === 0) return undefined;
    const cells = csvParseRows(line)[0] ?? [];

    if (index === 0) {
      if (cells.length !== expected.length || cells.some((c, i) => c !== expected[i])) {
        throw new Error(
          `CSV header ${JSON.stringify(cells)} does not match expected ${JSON.stringify(expected)}`,
        );
      }
      index++;
      return undefined;
    }

    /* Cell counts are checked on the raw cells: a short row would otherwise
     * read its missing cells as empty, and so as null.
     */
    if (cells.length !== expected.length) {
      throw new Error(
        `CSV row ${index - 1} has ${cells.length} cells, expected ${expected.length}`,
      );
    }
    index++;
    return schema.parse(Object.fromEntries(expected.map((c, i) => [c, cells[i]])));
  };
}
