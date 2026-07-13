// Parses the Velo API's CSV responses. d3-dsv owns the CSV grammar; cells are
// coerced here rather than with d3's autoType so the rules stay exact ("" -> null,
// booleans, numbers) and ISO-8601-looking strings never become Date objects.

import { csvParse } from "d3-dsv";

export type CsvValue = string | number | boolean | null;
export type CsvRow = Record<string, CsvValue>;

export function parseCsvValue(raw: string): CsvValue {
  if (raw === "") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;
  const n = Number(raw);
  return Number.isNaN(n) ? raw : n;
}

/** Parse a header-first CSV body into one plain object per row, keyed by header column. */
export function parseCsv(text: string): CsvRow[] {
  return Array.from(csvParse(text), (raw) =>
    Object.fromEntries(Object.keys(raw).map((key) => [key, parseCsvValue(raw[key] ?? "")])),
  );
}
