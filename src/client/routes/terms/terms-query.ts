import { z } from "zod";

import { TERMS_PATH } from "../../../constants.js";
import { VeloError } from "../../../errors.js";
import type { Http } from "../../../transport/http.js";
import { decode } from "../../decode/decode.js";
import { Query } from "../../query.js";
import { TERMS_COINS, termPointSchema, type TermPoint, type TermsCoin } from "../rows/columns.js";

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
      throw new VeloError(`Invalid terms params:\n${z.prettifyError(parsed.error)}`);
    }

    return parsed.data;
  },
});

/** Creates validated lazy options term-structure queries bound to an HTTP transport. */
export class TermsQuery {
  readonly #http: Http;

  constructor(http: Http) {
    this.#http = http;
  }

  /** Creates a lazy query from raw options term-structure parameters. */
  build(params: TermsParams): Query<TermPoint> {
    const parsed = TermsParams.parse(params);
    return new Query(this.#http, {
      requests: [
        {
          path: TERMS_PATH,
          params: { coins: parsed.coins },
        },
      ],
      decode: decodeTerms,
    });
  }
}

/** Decodes a terms response and adds endpoint context to malformed data errors. */
function decodeTerms(body: string): TermPoint[] {
  try {
    return decode(body, termPointSchema);
  } catch (cause) {
    throw new VeloError(`Unexpected ${TERMS_PATH} response`, { cause });
  }
}
