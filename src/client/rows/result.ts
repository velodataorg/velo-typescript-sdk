import type { CsvSchema, FromSchema } from "../../util/csv.js";
import type { Exchange } from "./markets.js";

/* Cell types of the columns every `/rows` response starts with, in wire order. */
export const ROWS_BASE_SCHEMA = {
  exchange: "string",
  coin: "string",
  /* Product symbol; equals `coin` for options, the dated contract for `3m_basis_ann`. */
  product: "string",
  /* Bucket start as a millisecond timestamp. */
  time: "number",
} as const satisfies CsvSchema;

/* Columns every `/rows` response starts with, in wire order. */
export const ROWS_BASE_COLUMNS = Object.keys(ROWS_BASE_SCHEMA) as (keyof typeof ROWS_BASE_SCHEMA)[];

/* `exchange` alone narrows past what decoding verifies: the server only
 * emits exchanges it accepts.
 */
export type RowBase = FromSchema<typeof ROWS_BASE_SCHEMA> & { exchange: Exchange };

/**
 * One `/rows` row: the base columns plus one numeric field per requested
 * column. A data field is null where the server has no value (SQL NULL in
 * the CSV).
 *
 * @typeParam C - The requested column names, one numeric field each.
 */
export type Row<C extends string> = RowBase & { [K in C]: number | null };
