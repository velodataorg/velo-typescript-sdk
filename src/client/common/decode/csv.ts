import { csvParseRows } from "d3-dsv";
import { z } from "zod";

import { timestamp } from "../validation.js";

/* Both transforms trim-check before converting: Number() turns
 * whitespace-only strings into 0, which would fabricate data from a
 * corrupt cell.
 */
export const csvNumber = z.string().transform((raw, context) => {
  const value = Number(raw);
  if (raw.trim() !== "" && Number.isFinite(value)) return value;

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

  const value = Number(raw);
  if (raw.trim() !== "" && Number.isFinite(value)) return value;

  context.addIssue({
    code: "custom",
    message: "expected a finite number or null",
  });
  return z.NEVER;
});

/**
 * Decodes header-first CSV text and validates every row with a Zod schema.
 *
 * The CSV header must contain exactly the schema's keys in the same order,
 * and every row must have a cell for every header column. An empty response
 * has no header and returns an empty array.
 *
 * @param text - The raw CSV response body.
 * @param schema - The schema for one raw CSV row.
 * @returns The validated and transformed rows.
 * @throws If the header, a row's cell count, or any cell does not match the
 * schema.
 */
export function decode<Schema extends z.ZodObject>(
  text: string,
  schema: Schema,
): z.output<Schema>[] {
  const parsed = csvParseRows(text);
  const expected = Object.keys(schema.shape);
  const actual = parsed[0] ?? [];

  if (
    parsed.length !== 0 &&
    (actual.length !== expected.length ||
      actual.some((column, index) => column !== expected[index]))
  ) {
    throw new Error(
      `CSV header ${JSON.stringify(actual)} does not match expected ${JSON.stringify(expected)}`,
    );
  }

  /* Cell counts are validated on the raw rows because csvParse would pad a
   * truncated row with empty — and therefore null — cells.
   */
  const rows = parsed.slice(1).map((cells, index) => {
    if (cells.length !== expected.length) {
      throw new Error(`CSV row ${index} has ${cells.length} cells, expected ${expected.length}`);
    }
    return Object.fromEntries(expected.map((column, position) => [column, cells[position]]));
  });

  return z.array(schema).parse(rows);
}
