import { csvParse } from "d3-dsv";

import { assert } from "./assert.js";

export type CsvValue = string | number | boolean | null;
export type CsvRow = Record<string, CsvValue>;

export function parseCsvValue(raw: string): CsvValue {
  if (raw === "") return null;
  if (raw === "null") return null; // the server serializes a SQL NULL as `${null}`
  if (raw === "true") return true;
  if (raw === "false") return false;
  const n = Number(raw);
  return Number.isNaN(n) ? raw : n;
}

/**
 * Parse a header-first CSV body into one plain object per row, keyed by
 * header column. `columns` is the header in wire order ([] for an empty body).
 */
export function parseCsv(text: string): { columns: string[]; rows: CsvRow[] } {
  const parsed = csvParse(text);
  const rows = Array.from(parsed, (raw) =>
    Object.fromEntries(Object.keys(raw).map((key) => [key, parseCsvValue(raw[key] ?? "")])),
  );
  return { columns: parsed.columns, rows };
}

/** Asserts a non-empty response's header matches the expected columns exactly, in order. */
export function assertColumns(
  actual: readonly string[],
  expected: readonly string[],
  path: string,
): void {
  if (actual.length === 0) return; // zero-row responses have no header
  assert(
    actual.length === expected.length && actual.every((col, i) => col === expected[i]),
    () => `unexpected ${path} response header ${actual.join(",")} (expected ${expected.join(",")})`,
  );
}
