import { z } from "zod";

import { VeloError } from "../../../../errors.js";
import { OPTIONS_EXCHANGES, type OptionsExchange } from "../../../../exchange.js";
import type { Http } from "../../../../transport/http.js";
import type { Query } from "../../../query.js";
import type { TermPoint } from "../../terms/schema.js";
import type { TermsParams } from "../../terms/terms.js";
import { createTermsQuery } from "../../terms/terms.js";
import { OPTIONS_COLUMNS, type OptionsColumn } from "../columns.js";
import type { Data, Row } from "../data.js";
import { RowsParams, RowsQuery } from "../params.js";

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

const ParamsSchema = RowsParams.schema(OPTIONS_EXCHANGES, OPTIONS_COLUMNS);

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
      return RowsQuery.create(http, "options", parsed.data, OPTIONS_EXCHANGES) as Query<
        OptionsRow<C>,
        Data<OptionsExchange, C>
      >;
    },
    terms(params: TermsParams): Query<TermPoint> {
      return createTermsQuery(http, params);
    },
  };
}
