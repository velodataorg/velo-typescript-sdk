import { z } from "zod";

import { TERMS_PATH } from "../../constants.js";
import { decode } from "../../decode/decode.js";
import { VeloError } from "../../errors.js";
import type { Http } from "../../transport/http.js";
import { Query } from "../query.js";
import { TERMS_COINS, TermPointSchema } from "./schema.js";
import type { TermPoint, TermsCoin } from "./schema.js";

const ParamsSchema = z.strictObject({
  coins: z.array(z.enum(TERMS_COINS)).min(1),
});

export interface TermsParams {
  readonly coins: readonly TermsCoin[];
}

/**
 * Creates a lazy options term-structure query.
 *
 * @param http - The transport used by the query.
 * @param params - Coins whose term structures should be returned.
 * @returns An unexecuted query over the term-structure points.
 * @throws If `coins` is empty, contains an unsupported coin, or the params
 * object has an unexpected shape.
 */
export function createTermsQuery(http: Http, params: TermsParams): Query<TermPoint> {
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    throw new VeloError(`Invalid terms params:\n${z.prettifyError(parsed.error)}`);
  }

  return new Query(http, {
    requests: [
      {
        path: TERMS_PATH,
        params: { coins: parsed.data.coins },
      },
    ],
    decode: decodeTerms,
  });
}

/**
 * Decodes a terms response and adds endpoint context to malformed data errors.
 */
function decodeTerms(body: string): TermPoint[] {
  try {
    return decode(body, TermPointSchema);
  } catch (cause) {
    throw new VeloError(`Unexpected ${TERMS_PATH} response`, { cause });
  }
}
