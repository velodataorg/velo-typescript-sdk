import { csvParse } from "d3-dsv";
import { z } from "zod";

import { timestamp } from "../validation.js";

export const csvNumber = z.string().transform((raw, context) => {
  const value = Number(raw);
  if (raw !== "" && Number.isFinite(value)) return value;

  context.addIssue({
    code: "custom",
    message: "expected a finite number",
  });
  return z.NEVER;
});

export const csvTimestamp = csvNumber.pipe(timestamp);

export const csvBoolean = z.enum(["true", "false"]).transform((value) => value === "true");

export const csvNumberOrNull = z.string().transform((raw, context) => {
  if (raw === "" || raw === "null") return null;

  const value = Number(raw);
  if (Number.isFinite(value)) return value;

  context.addIssue({
    code: "custom",
    message: "expected a finite number or null",
  });
  return z.NEVER;
});

/**
 * Decodes header-first CSV text and validates every row with a Zod schema.
 *
 * The CSV header must contain exactly the schema's keys in the same order.
 * An empty response has no header and returns an empty array.
 *
 * @param text - The raw CSV response body.
 * @param schema - The schema for one raw CSV row.
 * @returns The validated and transformed rows.
 * @throws If the header or any row does not match the schema.
 */
export function decode<Schema extends z.ZodObject>(
  text: string,
  schema: Schema,
): z.output<Schema>[] {
  const parsed = csvParse(text);
  const expected = Object.keys(schema.shape);
  const actual = parsed.columns;

  if (
    actual.length !== 0 &&
    (actual.length !== expected.length ||
      actual.some((column, index) => column !== expected[index]))
  ) {
    throw new Error(
      `CSV header ${JSON.stringify(actual)} does not match expected ${JSON.stringify(expected)}`,
    );
  }

  const rows = Array.from(parsed, (row) =>
    Object.fromEntries(actual.map((column) => [column, row[column] ?? ""])),
  );

  return z.array(schema).parse(rows);
}
