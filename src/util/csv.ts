import { csvParse } from "d3-dsv";

import { assert } from "./assert.js";

export type CsvValue = string | number | boolean | null;
export type CsvRow = Record<string, CsvValue>;

/**
 * Parses one CSV field into its typed value.
 *
 * @param raw - The raw field text.
 * @returns null for empty and SQL-NULL fields, a boolean or number where the
 * text is one, and the text itself otherwise.
 */
export function parseCsvValue(raw: string): CsvValue {
  if (raw === "") return null;
  if (raw === "null") return null; // the server serializes a SQL NULL as `${null}`
  if (raw === "true") return true;
  if (raw === "false") return false;
  const n = Number(raw);
  return Number.isNaN(n) ? raw : n;
}

/**
 * Parses a header-first CSV body into one plain object per row, keyed by
 * header column.
 *
 * @param text - The CSV body.
 * @returns The header in wire order (`[]` for an empty body) and the parsed
 * rows.
 */
export function parseCsv(text: string): { columns: string[]; rows: CsvRow[] } {
  const parsed = csvParse(text);
  const rows = Array.from(parsed, (raw) =>
    Object.fromEntries(Object.keys(raw).map((key) => [key, parseCsvValue(raw[key] ?? "")])),
  );
  return { columns: parsed.columns, rows };
}

/**
 * Asserts a non-empty response's header matches the expected columns
 * exactly, in order. Zero-row responses have no header and pass.
 *
 * @param actual - The header parsed from the response.
 * @param expected - The columns the endpoint must return.
 * @param path - The endpoint path, for the failure message.
 * @throws If the header differs from `expected` in length, order, or names.
 */
export function assertCsvHeader(
  actual: readonly string[],
  expected: readonly string[],
  path: string,
): void {
  if (actual.length === 0) return;
  assert(
    actual.length === expected.length && actual.every((col, i) => col === expected[i]),
    () => `unexpected ${path} response header ${actual.join(",")} (expected ${expected.join(",")})`,
  );
}
