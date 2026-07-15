import type { Exchange } from "../constants.js";

/** Columns every /rows response starts with, in wire order. */
export const ROWS_BASE_COLUMNS = ["exchange", "coin", "product", "time"] as const;

// Object type aliases (not interfaces) so the rows stay mutually assignable
// with the CsvRow record they are parsed as; interfaces have no implicit
// index signature.
export type RowsRowBase = {
  exchange: Exchange;
  coin: string;
  /** Product symbol; equals `coin` for options, the dated contract for 3m_basis_ann. */
  product: string;
  /** Bucket start as a millisecond timestamp. */
  time: number;
};

/** One /rows row: the base columns plus one numeric field per requested column. */
export type RowsRow<C extends string> = RowsRowBase & { [K in C]: number };

/** The /caps response columns, in wire order. */
export const CAPS_COLUMNS = ["coin", "time", "circ", "circ_dollars", "fdv", "fdv_dollars"] as const;

/** One /caps row. */
export type CapsRow = {
  coin: string;
  /** Per-coin "as of" millisecond timestamp (not bucket-aligned). */
  time: number;
  circ: number;
  circ_dollars: number;
  fdv: number;
  fdv_dollars: number;
};

/** The /terms response columns, in wire order. */
export const TERMS_COLUMNS = ["coin", "time", "at_the_money_iv", "dte", "fwd_iv"] as const;

/** One /terms row: a point on the options term structure. */
export type TermsRow = {
  coin: string;
  /** Expiry as a millisecond timestamp. */
  time: number;
  at_the_money_iv: number;
  /** Days to expiry. */
  dte: number;
  fwd_iv: number;
};
