import { CAPS_PATH } from "../../../constants/endpoints.ts";
import { VeloError } from "../../../errors.ts";
import { decode, decodeLines } from "../../decode/csv.ts";
import type { QueryPlan } from "../../query/query.ts";
import { MarketCapsParams } from "./params.ts";
import { marketCapSchema, type MarketCap } from "./validation.ts";

/** Plans a market-cap history query. */
export function planMarketCapsHistory(params: MarketCapsParams): QueryPlan<MarketCap> {
  const parsed = MarketCapsParams.parse(params);
  return {
    requests: [{ path: CAPS_PATH, params: { coins: parsed.coins } }],
    decode: decodeMarketCaps,
    async *decodeLines(lines) {
      try {
        yield* decodeLines(lines, marketCapSchema);
      } catch (cause) {
        throw new VeloError(`Unexpected ${CAPS_PATH} response`, { cause });
      }
    },
  };
}

/** Decodes a market-caps response and adds endpoint context to malformed data errors. */
function decodeMarketCaps(body: string): MarketCap[] {
  try {
    return decode(body, marketCapSchema);
  } catch (cause) {
    throw new VeloError(`Unexpected ${CAPS_PATH} response`, { cause });
  }
}
