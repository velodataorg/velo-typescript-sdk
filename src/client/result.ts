import type { Exchange } from "../constants.js";

/** Columns every /rows response starts with, in wire order. */
export const ROWS_BASE_COLUMNS = ["exchange", "coin", "product", "time"] as const;

// Object type aliases (not interfaces) so the rows stay mutually assignable
// with the CsvRow record they are parsed as; interfaces have no implicit
// index signature.
export type RowBase = {
  exchange: Exchange;
  coin: string;
  /** Product symbol; equals `coin` for options, the dated contract for 3m_basis_ann. */
  product: string;
  /** Bucket start as a millisecond timestamp. */
  time: number;
};

/**
 * One /rows row: the base columns plus one numeric field per requested column.
 * A data field is null where the server has no value (SQL NULL in the CSV).
 */
export type Row<C extends string> = RowBase & { [K in C]: number | null };

/** The /caps response columns, in wire order. */
export const CAPS_COLUMNS = ["coin", "time", "circ", "circ_dollars", "fdv", "fdv_dollars"] as const;

/**
 * One /caps row: a coin's market capitalization. A data field is null where
 * the server has no value (SQL NULL in the CSV).
 */
export type MarketCap = {
  coin: string;
  /** Per-coin "as of" millisecond timestamp (not bucket-aligned). */
  time: number;
  circ: number | null;
  circ_dollars: number | null;
  fdv: number | null;
  fdv_dollars: number | null;
};

/** The /terms response columns, in wire order. */
export const TERMS_COLUMNS = ["coin", "time", "at_the_money_iv", "dte", "fwd_iv"] as const;

/**
 * One /terms row: a point on the options term structure. A data field is null
 * where the server has no value (SQL NULL in the CSV).
 */
export type TermPoint = {
  coin: string;
  /** Expiry as a millisecond timestamp. */
  time: number;
  at_the_money_iv: number | null;
  /** Days to expiry. */
  dte: number | null;
  fwd_iv: number | null;
};
