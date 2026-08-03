import { z } from "zod";

import { CAPS_PATH } from "../../../constants/endpoints.ts";
import { VeloError } from "../../../errors.ts";
import type { Http } from "../../../transport/http.ts";
import { decode } from "../../common/decode/csv.ts";
import { Query } from "../../common/query.ts";
import { invalidParamsError } from "../../common/validation.ts";
import { marketCapSchema, type MarketCap } from "./validation.ts";

export interface MarketCapsParams {
  readonly coins: readonly string[];
}

const MarketCapsParamsSchema = z.strictObject({
  coins: z.array(z.string().min(1)).min(1),
});

export const MarketCapsParams = Object.freeze({
  /** Validates market-caps parameters. */
  parse(params: MarketCapsParams): MarketCapsParams {
    const parsed = MarketCapsParamsSchema.safeParse(params);
    if (!parsed.success) {
      throw invalidParamsError("market-caps", parsed.error);
    }

    return parsed.data;
  },
});

/** Creates validated lazy market-caps queries bound to an HTTP transport. */
export class MarketCapsQuery {
  readonly #http: Http;

  constructor(http: Http) {
    this.#http = http;
  }

  /** Creates a lazy query from raw market-caps parameters. */
  build(params: MarketCapsParams): Query<MarketCap> {
    const parsed = MarketCapsParams.parse(params);
    return new Query(this.#http, {
      requests: [
        {
          path: CAPS_PATH,
          params: { coins: parsed.coins },
        },
      ],
      decode: (body) => this.#decodeMarketCaps(body),
    });
  }

  /** Decodes a market-caps response and adds endpoint context to malformed data errors. */
  #decodeMarketCaps(body: string): MarketCap[] {
    try {
      return decode(body, marketCapSchema);
    } catch (cause) {
      throw new VeloError(`Unexpected ${CAPS_PATH} response`, { cause });
    }
  }
}
