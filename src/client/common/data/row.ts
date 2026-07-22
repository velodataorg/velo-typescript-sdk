import { z } from "zod";

import { csvNumberOrNull, csvTimestamp } from "../decode/csv.js";

/**
 * Fields present at the start of every `/rows` response.
 *
 * @typeParam E - Exchanges the market may return.
 */
export interface RowBase<E extends string = string> {
  readonly exchange: E;
  readonly coin: string;
  readonly product: string;
  readonly time: number;
}

/**
 * One market-data row: the base fields plus the requested numeric columns.
 *
 * Data fields are null where the API returns SQL NULL.
 *
 * @typeParam E - Exchanges the market may return.
 * @typeParam C - Columns requested by the query.
 */
export type Row<E extends string, C extends string> = RowBase<E> & {
  readonly [K in C]: number | null;
};

export const Row = Object.freeze({
  columns: ["exchange", "coin", "product", "time"] as const,

  /** Creates the strict response schema for one requested column selection. */
  schema<E extends string, C extends string>(
    exchanges: readonly [E, ...E[]],
    columns: readonly C[],
  ): z.ZodObject {
    const dataColumns = Object.fromEntries(
      columns.map((column) => [column, csvNumberOrNull] as const),
    );

    return z.strictObject({
      exchange: z.enum(exchanges),
      coin: z.string().min(1),
      product: z.string().min(1),
      time: csvTimestamp,
      ...dataColumns,
    });
  },
});

/**
 * The column names of a row type: its keys minus the base fields.
 *
 * @typeParam R - A decoded row type.
 */
export type RowColumns<R extends RowBase> = Extract<Exclude<keyof R, keyof RowBase>, string>;
