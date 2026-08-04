import { csvParseRows } from "d3-dsv";
import { z } from "zod";

import { timestamp } from "../validation.ts";

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

/**
 * Decodes header-first CSV from its lines as they arrive.
 *
 * Applies the same header, cell-count, and schema checks as {@link decode},
 * but validates and yields each row as soon as its line lands rather than
 * waiting for the whole body. An empty response yields nothing.
 *
 * @param lines - The response body's lines, without trailing newlines.
 * @param schema - The schema for one raw CSV row.
 * @returns The validated and transformed rows, in response order.
 * @throws If the header, a row's cell count, or any cell does not match the
 * schema.
 */
export async function* decodeLines<Schema extends z.ZodObject>(
  lines: AsyncIterable<string>,
  schema: Schema,
): AsyncGenerator<z.output<Schema>> {
  const expected = Object.keys(schema.shape);
  let index = 0;

  for await (const line of lines) {
    /* The server terminates the body with a newline, so the split yields a
     * trailing empty line that carries no row.
     */
    if (line.length === 0) continue;
    const cells = csvParseRows(line)[0] ?? [];

    if (index === 0) {
      if (cells.length !== expected.length || cells.some((c, i) => c !== expected[i])) {
        throw new Error(
          `CSV header ${JSON.stringify(cells)} does not match expected ${JSON.stringify(expected)}`,
        );
      }
      index++;
      continue;
    }

    if (cells.length !== expected.length) {
      throw new Error(
        `CSV row ${index - 1} has ${cells.length} cells, expected ${expected.length}`,
      );
    }
    yield schema.parse(Object.fromEntries(expected.map((c, i) => [c, cells[i]])));
    index++;
  }
}
