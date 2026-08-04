import { CAPS_PATH } from "../../../constants/endpoints.ts";
import { VeloError } from "../../../errors.ts";
import { decode } from "../../common/decode/csv.ts";
import type { QueryPlan } from "../../common/query.ts";
import { MarketCapsParams } from "./params.ts";
import { marketCapSchema, type MarketCap } from "./validation.ts";

/** Plans a market-cap history query. */
export function planMarketCapsHistory(params: MarketCapsParams): QueryPlan<MarketCap> {
  const parsed = MarketCapsParams.parse(params);
  return {
    requests: [{ path: CAPS_PATH, params: { coins: parsed.coins } }],
    decode: decodeMarketCaps,
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
