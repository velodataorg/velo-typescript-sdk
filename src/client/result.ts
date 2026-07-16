import type { Exchange } from "../constants.js";
import type { CsvSchema, FromSchema } from "../util/csv.js";

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

/* Cell types of the /caps response columns, in wire order. */
export const CAPS_SCHEMA = {
  coin: "string",
  /* Per-coin "as of" millisecond timestamp (not bucket-aligned). */
  time: "number",
  circ: "nullable-number",
  circ_dollars: "nullable-number",
  fdv: "nullable-number",
  fdv_dollars: "nullable-number",
} as const satisfies CsvSchema;

/* The /caps response columns, in wire order. */
export const CAPS_COLUMNS = Object.keys(CAPS_SCHEMA) as (keyof typeof CAPS_SCHEMA)[];

/* One `/caps` row: a coin's market capitalization. A data field is null where
 * the server has no value (SQL NULL in the CSV).
 */
export type MarketCap = FromSchema<typeof CAPS_SCHEMA>;

/* Cell types of the /terms response columns, in wire order. */
export const TERMS_SCHEMA = {
  coin: "string",
  /* Expiry as a millisecond timestamp. */
  time: "number",
  at_the_money_iv: "nullable-number",
  /* Days to expiry. */
  dte: "nullable-number",
  fwd_iv: "nullable-number",
} as const satisfies CsvSchema;

/* The /terms response columns, in wire order. */
export const TERMS_COLUMNS = Object.keys(TERMS_SCHEMA) as (keyof typeof TERMS_SCHEMA)[];

/* One `/terms` row: a point on the options term structure. A data field is null
 * where the server has no value (SQL NULL in the CSV).
 */
export type TermPoint = FromSchema<typeof TERMS_SCHEMA>;
