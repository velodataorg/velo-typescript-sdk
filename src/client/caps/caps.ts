import { CAPS_PATH } from "../../constants.js";
import { assert, assertStringArray } from "../../util/assert.js";
import type { CsvSchema, FromSchema } from "../../util/csv.js";
import type { PreparedParams } from "../query.js";

/* Parameters for one market-caps query (`/api/v1/caps`). */
export interface CapsParams {
  /* Coins to fetch caps for, e.g. "BTC". */
  readonly coins: readonly string[];
}

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

/**
 * Validates and lowers a /caps query — always a single request.
 *
 * @param params - The caps params.
 * @returns The prepared query.
 * @throws If `coins` is empty or not an array of non-empty strings.
 */
export function prepareCaps(params: CapsParams): PreparedParams<MarketCap> {
  assertStringArray(params.coins, "coins");
  assert(params.coins.length > 0, "coins must not be empty");
  return {
    path: CAPS_PATH,
    requests: [{ coins: [...params.coins] }],
    // Spread so the Query constructor's freeze never freezes the shared constant.
    schema: { ...CAPS_SCHEMA },
  };
}
