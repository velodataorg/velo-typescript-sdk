import { z } from "zod";

import { VeloError } from "../../../../errors.js";
import { SPOT_EXCHANGES, type SpotExchange } from "../../../../exchange.js";
import type { Http } from "../../../../transport/http.js";
import type { Query } from "../../../query.js";
import { SPOT_COLUMNS, type SpotColumn } from "../columns.js";
import type { Data, Row } from "../data.js";
import { RowsParams, RowsQuery } from "../params.js";

export type SpotRow<C extends SpotColumn> = Row<SpotExchange, C>;
export type SpotParams<C extends SpotColumn = SpotColumn> = RowsParams<SpotExchange, C>;

export interface Spot {
  query<C extends SpotColumn>(params: SpotParams<C>): Query<SpotRow<C>, Data<SpotExchange, C>>;
}

const ParamsSchema = RowsParams.schema(SPOT_EXCHANGES, SPOT_COLUMNS);

/**
 * Creates the spot `/rows` namespace bound to an HTTP transport.
 */
export function createSpot(http: Http): Spot {
  return {
    query<C extends SpotColumn>(params: SpotParams<C>): Query<SpotRow<C>, Data<SpotExchange, C>> {
      const parsed = ParamsSchema.safeParse(params);
      if (!parsed.success) {
        throw new VeloError(`Invalid spot params:\n${z.prettifyError(parsed.error)}`);
      }
      return RowsQuery.create(http, "spot", parsed.data, SPOT_EXCHANGES) as Query<
        SpotRow<C>,
        Data<SpotExchange, C>
      >;
    },
  };
}
