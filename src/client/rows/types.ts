export type MarketType = "futures" | "options" | "spot";

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
