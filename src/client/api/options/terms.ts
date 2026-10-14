import { z } from "zod";

import { TERMS_PATH } from "../../../constants/endpoints.ts";
import { csvNumberOrNull, csvRows, csvTimestamp } from "../../decode/csv.ts";
import { decodeLines } from "../../decode/lines.ts";
import type { QueryBuilder, QueryRequest } from "../../query/plan.ts";
import { invalidParamsError } from "../../validation.ts";

export const TERMS_COINS = ["BTC", "ETH"] as const;
export type TermsCoin = (typeof TERMS_COINS)[number];

const termPointSchema = z.strictObject({
  coin: z.enum(TERMS_COINS),
  time: csvTimestamp,
  at_the_money_iv: csvNumberOrNull,
  dte: csvNumberOrNull,
  fwd_iv: csvNumberOrNull,
});

export type TermPoint = z.output<typeof termPointSchema>;

export const TERMS_COLUMNS = Object.keys(termPointSchema.shape) as (keyof TermPoint)[];

export interface TermsParams {
  readonly coins: readonly TermsCoin[];
}

const TermsParamsSchema = z.strictObject({
  coins: z.array(z.enum(TERMS_COINS)).min(1),
});

export const TermsParams = Object.freeze({
  /** Validates options term-structure parameters. */
  parse(params: TermsParams): TermsParams {
    const parsed = TermsParamsSchema.safeParse(params);
    if (!parsed.success) {
      throw invalidParamsError("terms", parsed.error);
    }

    return parsed.data;
  },
});

/** An immutable options term-structure request builder. */
export class OptionsTermsBuilder implements QueryBuilder<"options.terms"> {
  readonly #request: QueryRequest<"options.terms">;

  constructor(params: TermsParams) {
    const snapshot = TermsParams.parse(params);
    Object.freeze(snapshot.coins);
    Object.freeze(snapshot);
    this.#request = Object.freeze({ kind: "options.terms", params: snapshot });
  }

  /** Returns the immutable transport-independent endpoint request. */
  build(): QueryRequest<"options.terms"> {
    return this.#request;
  }
}

/**
 * Decodes a term-structure response from its lines.
 *
 * @param lines - The response body's lines.
 * @returns The term points, in response order.
 */
export function decodeTermsLines(lines: AsyncIterable<string>): AsyncIterable<TermPoint> {
  return decodeLines(lines, csvRows(termPointSchema), TERMS_PATH);
}
