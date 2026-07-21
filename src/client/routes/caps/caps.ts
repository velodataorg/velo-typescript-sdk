import { z } from "zod";

import { CAPS_PATH } from "../../../constants.js";
import { VeloError } from "../../../errors.js";
import type { Http } from "../../../transport/http.js";
import { decode } from "../../decode/decode.js";
import { Query } from "../../query.js";
import { MarketCapSchema } from "./schema.js";
import type { MarketCap } from "./schema.js";

const ParamsSchema = z.strictObject({
  coins: z.array(z.string().min(1)).min(1),
});

export interface CapsParams {
  readonly coins: readonly string[];
}

export interface Caps {
  query(params: CapsParams): Query<MarketCap>;
}

/**
 * Creates the market-caps endpoint bound to an HTTP transport.
 *
 * @param http - The transport used by caps queries.
 * @returns The market-caps endpoint.
 */
export function createCaps(http: Http): Caps {
  return {
    query(params: CapsParams): Query<MarketCap> {
      const parsed = ParamsSchema.safeParse(params);
      if (!parsed.success) {
        throw new VeloError(`Invalid caps params:\n${z.prettifyError(parsed.error)}`);
      }

      return new Query(http, {
        requests: [
          {
            path: CAPS_PATH,
            params: { coins: parsed.data.coins },
          },
        ],
        decode: _decodeCaps,
      });
    },
  };
}

/**
 * Decodes a caps response and adds endpoint context to malformed data errors.
 */
function _decodeCaps(body: string): MarketCap[] {
  try {
    return decode(body, MarketCapSchema);
  } catch (cause) {
    throw new VeloError(`Unexpected ${CAPS_PATH} response`, { cause });
  }
}
