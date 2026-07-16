import { TERMS_PATH } from "../../constants.js";
import { assert, assertStringArray } from "../../util/assert.js";
import type { CsvSchema, FromSchema } from "../../util/csv.js";
import type { PreparedParams } from "../query.js";
import { freezePrepared } from "../query.js";

export const TERMS_COINS = ["BTC", "ETH"] as const;
export type TermsCoin = (typeof TERMS_COINS)[number];

/* Parameters for one options term-structure query (`/api/v1/terms`). */
export interface TermsParams {
  /* Coins to fetch the term structure for; only BTC and ETH are supported. */
  readonly coins: readonly TermsCoin[];
}

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

/**
 * Validates and lowers a /terms query — always a single request.
 *
 * @param params - The terms params.
 * @returns The prepared query, deep-frozen.
 * @throws If `coins` is empty or contains an unsupported coin.
 */
export function prepareTerms(params: TermsParams): PreparedParams<TermPoint> {
  assertStringArray(params.coins, "coins");
  assert(params.coins.length > 0, "coins must not be empty");
  assert(
    params.coins.every((coin) => TERMS_COINS.includes(coin)),
    `terms coins must be among ${TERMS_COINS.join(", ")}`,
  );
  return freezePrepared({
    path: TERMS_PATH,
    requests: [{ coins: [...params.coins] }],
    // Spread so freezing the prepared query never freezes the shared constant.
    schema: { ...TERMS_SCHEMA },
  });
}
