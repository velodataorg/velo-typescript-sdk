import { TERMS_PATH } from "../../../constants/endpoints.ts";
import type { DataResult } from "../../common/data/data.ts";
import type { OptionsColumn } from "../../common/market/columns.ts";
import { OPTIONS_EXCHANGES, type OptionsExchange } from "../../common/market/exchanges.ts";
import type { QueryPlan } from "../../common/query.ts";
import { planRows } from "../../common/rows/plan.ts";
import { OptionsParams, type OptionsRow } from "./params.ts";
import { decodeTerms, decodeTermsLines, type TermPoint, TermsParams } from "./terms.ts";

/** Plans an options rows query. */
export function planOptionsRows<C extends OptionsColumn>(
  params: OptionsParams<C>,
): QueryPlan<OptionsRow<C>, DataResult<OptionsExchange, C>> {
  const parsed = OptionsParams.parse(params);
  return planRows("options", parsed, OPTIONS_EXCHANGES);
}

/** Plans an options term-structure query. */
export function planOptionsTerms(params: TermsParams): QueryPlan<TermPoint> {
  const parsed = TermsParams.parse(params);
  return {
    requests: [{ path: TERMS_PATH, params: { coins: parsed.coins } }],
    decode: decodeTerms,
    decodeLines: decodeTermsLines,
  };
}
