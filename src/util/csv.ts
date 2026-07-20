import { csvParse } from "d3-dsv";
import { z } from "zod";

import { VeloError } from "../errors.js";
import { assert } from "./assert.js";

export type CsvValue = string | number | boolean | null;
export type CsvRow = Record<string, CsvValue>;

/* How to decode one column's cells; "nullable-number" admits SQL NULL. */
export type CsvCellType = "string" | "number" | "nullable-number" | "boolean";

/* Expected response columns in wire order, each with its cell type. Key order
 * is significant: the header is asserted against it. (Insertion order is
 * reliable here because no column name is an integer-like key.)
 */
export type CsvSchema = Record<string, CsvCellType>;

/* The value a cell type decodes to. */
export type CellOf<T extends CsvCellType> = {
  string: string;
  number: number;
  "nullable-number": number | null;
  boolean: boolean;
}[T];

/* The row type a schema decodes to. Row types are derived from their schema
 * so they cannot drift from what decodeCsv actually validates.
 */
export type FromSchema<S extends CsvSchema> = { -readonly [K in keyof S]: CellOf<S[K]> };

/**
 * Decodes one CSV field per its declared type.
 *
 * @remarks
 * Decoding by declared type rather than by what the text looks like keeps
 * lexical accidents out of the data: a coin named `888` stays a string, and a
 * malformed numeric cell fails loudly instead of leaking a string into a
 * `number` field.
 *
 * @param raw - The raw field text; missing trailing cells arrive as `""`.
 * @param type - The column's declared cell type.
 * @param column - The column name, for the failure message.
 * @param path - The endpoint path, for the failure message.
 * @returns The decoded value.
 * @throws If `raw` is not a valid cell of `type`.
 */
function decodeCsvCell(raw: string, type: CsvCellType, column: string, path: string): CsvValue {
  if (type === "string") {
    assert(raw !== "", () => `unexpected ${path} response: column ${column} is empty`);
    return raw;
  }
  if (type === "boolean") {
    assert(
      raw === "true" || raw === "false",
      () =>
        `unexpected ${path} response: column ${column} expected a boolean, got ${JSON.stringify(raw)}`,
    );
    return raw === "true";
  }
  if (type === "nullable-number" && (raw === "" || raw === "null")) return null;
  const n = Number(raw);
  assert(
    raw !== "" && Number.isFinite(n),
    () =>
      `unexpected ${path} response: column ${column} expected a number, got ${JSON.stringify(raw)}`,
  );
  return n;
}

/**
 * Parses a header-first CSV body into one plain object per row, validated
 * against the expected schema.
 *
 * @remarks
 * All-or-nothing: the header must match the schema's columns exactly and
 * every cell must decode as its column's type. A zero-row response has no
 * header and yields no rows.
 *
 * @param text - The CSV body.
 * @param schema - The expected columns in wire order, with their cell types.
 * @param path - The endpoint path, for failure messages.
 * @returns The decoded rows.
 * @throws If the header or any cell does not match `schema`.
 */
export function decodeCsv(text: string, schema: CsvSchema, path: string): CsvRow[] {
  const parsed = csvParse(text);
  assertCsvHeader(parsed.columns, Object.keys(schema), path);
  return Array.from(parsed, (raw) =>
    Object.fromEntries(
      Object.entries(schema).map(([column, type]) => [
        column,
        decodeCsvCell(raw[column] ?? "", type, column, path),
      ]),
    ),
  );
}

/**
 * Parses CSV rows through a Zod schema whose inputs are raw cell strings.
 *
 * @param text - The header-first CSV body.
 * @param schema - The Zod schema for one raw row.
 * @param path - The endpoint path, for failure messages.
 * @returns The parsed schema outputs.
 * @throws If the header or any row does not match the schema.
 */
export function parseCsv<S extends z.ZodObject>(
  text: string,
  schema: S,
  path: string,
): z.output<S>[] {
  const parsed = csvParse(text);
  assertCsvHeader(parsed.columns, Object.keys(schema.shape), path);

  const rows = Array.from(parsed, (raw) =>
    Object.fromEntries(parsed.columns.map((column) => [column, raw[column] ?? ""])),
  );
  const result = z.array(schema).safeParse(rows);
  if (!result.success) {
    throw new VeloError(`unexpected ${path} response:\n${z.prettifyError(result.error)}`, {
      cause: result.error,
    });
  }
  return result.data;
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
