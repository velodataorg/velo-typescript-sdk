import { z } from "zod";

import { TERMS_PATH } from "../../../constants/endpoints.ts";
import { VeloError } from "../../../errors.ts";
import type { HttpRequestOptions } from "../../../transport/http.ts";
import { csvNumberOrNull, csvTimestamp, decode } from "../../common/decode/csv.ts";
import type { Query } from "../../common/query.ts";
import { invalidParamsError } from "../../common/validation.ts";
import type { QueryBuilder, QueryRequest } from "../../plan.ts";

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

/** Binds an options term-structure request to the central lazy-query constructor. */
export type OptionsTermsQueryFactory = (
  request: QueryRequest<"options.terms">,
) => Query<TermPoint, TermPoint[]>;

/** An immutable options term-structure request builder bound to one client. */
export class OptionsTermsBuilder implements QueryBuilder<"options.terms"> {
  readonly #request: QueryRequest<"options.terms">;
  readonly #query: OptionsTermsQueryFactory;

  constructor(params: TermsParams, query: OptionsTermsQueryFactory) {
    const snapshot = TermsParams.parse(params);
    Object.freeze(snapshot.coins);
    Object.freeze(snapshot);
    this.#request = Object.freeze({ kind: "options.terms", params: snapshot });
    this.#query = query;
  }

  /** Returns the immutable transport-independent endpoint request. */
  build(): QueryRequest<"options.terms"> {
    return this.#request;
  }

  /** Creates and immediately executes a lazy query through the bound client. */
  fetch(options?: HttpRequestOptions): Promise<TermPoint[]> {
    return this.#query(this.#request).execute(options);
  }

  /** Creates a lazy query and streams term points through the bound client. */
  stream(options?: HttpRequestOptions): AsyncIterable<TermPoint> {
    return this.#query(this.#request).stream(options);
  }
}

/** Decodes a terms response and adds endpoint context to malformed data errors. */
export function decodeTerms(body: string): TermPoint[] {
  try {
    return decode(body, termPointSchema);
  } catch (cause) {
    throw new VeloError(`Unexpected ${TERMS_PATH} response`, { cause });
  }
}
