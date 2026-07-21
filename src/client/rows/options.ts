import { z } from "zod";

import { VeloError } from "../../errors.js";
import type { Http } from "../../transport/http.js";
import type { Query } from "../query.js";
import type { TermPoint } from "../terms/schema.js";
import type { TermsParams } from "../terms/terms.js";
import { createTermsQuery } from "../terms/terms.js";
import type { Data } from "./data.js";
import type { RowsParams } from "./params.js";
import { createRowsParamsSchema } from "./params.js";
import { createRowsQuery } from "./prepare.js";
import type { Row } from "./types.js";

export const OPTIONS_EXCHANGES = ["deribit"] as const;
export type OptionsExchange = (typeof OPTIONS_EXCHANGES)[number];

export const OPTIONS_COLUMNS = [
  "iv_1w",
  "iv_1m",
  "iv_3m",
  "iv_6m",
  "skew_1w",
  "skew_1m",
  "skew_3m",
  "skew_6m",
  "vega_coins",
  "vega_dollars",
  "call_delta_coins",
  "call_delta_dollars",
  "put_delta_coins",
  "put_delta_dollars",
  "gamma_coins",
  "gamma_dollars",
  "call_volume",
  "call_premium",
  "call_notional",
  "put_volume",
  "put_premium",
  "put_notional",
  "dollar_volume",
  "dvol_open",
  "dvol_high",
  "dvol_low",
  "dvol_close",
  "index_price",
] as const;

export type OptionsColumn = (typeof OPTIONS_COLUMNS)[number];
export type OptionsRow<C extends OptionsColumn> = Row<OptionsExchange, C>;
export type OptionsParams<C extends OptionsColumn = OptionsColumn> = RowsParams<OptionsExchange, C>;

export interface Options {
  /** Creates an options market-data query (`/api/v1/rows`). */
  query<C extends OptionsColumn>(
    params: OptionsParams<C>,
  ): Query<OptionsRow<C>, Data<OptionsExchange, C>>;

  /** Creates an options term-structure query (`/api/v1/terms`). */
  terms(params: TermsParams): Query<TermPoint>;
}

const ParamsSchema = createRowsParamsSchema(OPTIONS_EXCHANGES, OPTIONS_COLUMNS);

/**
 * Creates the options namespace bound to an HTTP transport.
 */
export function createOptions(http: Http): Options {
  return {
    query<C extends OptionsColumn>(
      params: OptionsParams<C>,
    ): Query<OptionsRow<C>, Data<OptionsExchange, C>> {
      const parsed = ParamsSchema.safeParse(params);
      if (!parsed.success) {
        throw new VeloError(`Invalid options params:\n${z.prettifyError(parsed.error)}`);
      }
      return createRowsQuery(http, "options", parsed.data, OPTIONS_EXCHANGES) as Query<
        OptionsRow<C>,
        Data<OptionsExchange, C>
      >;
    },
    terms(params: TermsParams): Query<TermPoint> {
      return createTermsQuery(http, params);
    },
  };
}
