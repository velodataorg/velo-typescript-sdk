import { z } from "zod";

import { VeloError } from "../../errors.js";
import type { Http } from "../../transport/http.js";
import type { Query } from "../query.js";
import type { Data } from "./data.js";
import type { RowsParams } from "./params.js";
import { createRowsParamsSchema } from "./params.js";
import { createRowsQuery } from "./prepare.js";
import type { Row } from "./types.js";

export const SPOT_EXCHANGES = ["binance", "bybit-spot", "coinbase", "okex"] as const;
export type SpotExchange = (typeof SPOT_EXCHANGES)[number];

export const SPOT_COLUMNS = [
  "open_price",
  "high_price",
  "low_price",
  "close_price",
  "coin_volume",
  "dollar_volume",
  "buy_trades",
  "sell_trades",
  "total_trades",
  "buy_coin_volume",
  "sell_coin_volume",
  "buy_dollar_volume",
  "sell_dollar_volume",
] as const;

export type SpotColumn = (typeof SPOT_COLUMNS)[number];
export type SpotRow<C extends SpotColumn> = Row<SpotExchange, C>;
export type SpotParams<C extends SpotColumn = SpotColumn> = RowsParams<SpotExchange, C>;

export interface Spot {
  query<C extends SpotColumn>(params: SpotParams<C>): Query<SpotRow<C>, Data<SpotExchange, C>>;
}

const ParamsSchema = createRowsParamsSchema(SPOT_EXCHANGES, SPOT_COLUMNS);

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
      return createRowsQuery(http, "spot", parsed.data, SPOT_EXCHANGES) as Query<
        SpotRow<C>,
        Data<SpotExchange, C>
      >;
    },
  };
}
