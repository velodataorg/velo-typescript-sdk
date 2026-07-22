import { z } from "zod";

import { CAPS_PATH } from "../../../constants.js";
import { VeloError } from "../../../errors.js";
import type { Http } from "../../../transport/http.js";
import { decode } from "../../decode/decode.js";
import { Query } from "../../query.js";
import { marketCapSchema, type MarketCap } from "../rows/columns.js";

export interface CapsParams {
  readonly coins: readonly string[];
}

const CapsParamsSchema = z.strictObject({
  coins: z.array(z.string().min(1)).min(1),
});

export const CapsParams = Object.freeze({
  /** Validates market-caps parameters. */
  parse(params: CapsParams): CapsParams {
    const parsed = CapsParamsSchema.safeParse(params);
    if (!parsed.success) {
      throw new VeloError(`Invalid caps params:\n${z.prettifyError(parsed.error)}`);
    }

    return parsed.data;
  },
});

/** Creates validated lazy market-caps queries bound to an HTTP transport. */
export class CapsQuery {
  readonly #http: Http;

  constructor(http: Http) {
    this.#http = http;
  }

  /** Creates a lazy query from raw market-caps parameters. */
  build(params: CapsParams): Query<MarketCap> {
    const parsed = CapsParams.parse(params);
    return new Query(this.#http, {
      requests: [
        {
          path: CAPS_PATH,
          params: { coins: parsed.coins },
        },
      ],
      decode: (body) => this.#decodeCaps(body),
    });
  }

  /** Decodes a caps response and adds endpoint context to malformed data errors. */
  #decodeCaps(body: string): MarketCap[] {
    try {
      return decode(body, marketCapSchema);
    } catch (cause) {
      throw new VeloError(`Unexpected ${CAPS_PATH} response`, { cause });
    }
  }
}
