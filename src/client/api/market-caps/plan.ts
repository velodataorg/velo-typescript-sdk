import { CAPS_PATH } from "../../../constants/endpoints.ts";
import { csvRows } from "../../decode/csv.ts";
import { decodeLines } from "../../decode/lines.ts";
import type { QueryPlan } from "../../query/query.ts";
import { MarketCapsParams } from "./params.ts";
import { marketCapSchema, type MarketCap } from "./validation.ts";

/** Plans a market-cap history query. */
export function planMarketCapsHistory(params: MarketCapsParams): QueryPlan<MarketCap> {
  const parsed = MarketCapsParams.parse(params);
  return {
    requests: [{ path: CAPS_PATH, params: { coins: parsed.coins } }],
    decodeLines: (lines) => decodeLines(lines, csvRows(marketCapSchema), CAPS_PATH),
  };
}
