import type { Http } from "../transport/http.js";
import { Query } from "./query.js";
import type { Column, MarketType } from "./rows/markets.js";
import type { RowsParamsCoins, RowsParamsProducts } from "./rows/params.js";
import type { Row } from "./rows/result.js";
import { prepareRows } from "./rows/rows.js";
import type { TermPoint, TermsParams } from "./terms/terms.js";
import { prepareTerms } from "./terms/terms.js";

/**
 * Entry point for querying one market namespace.
 *
 * @typeParam T - The market namespace this instance queries.
 */
export class Market<T extends MarketType> {
  protected readonly http: Http;
  private readonly type: T;

  /**
   * @param http - The transport requests are sent through.
   * @param type - The market namespace this instance queries.
   */
  constructor(http: Http, type: T) {
    this.http = http;
    this.type = type;
  }

  /**
   * Creates a market-data query (`/api/v1/rows`), validated and lowered to
   * wire requests; nothing is sent until execute() or stream().
   *
   * @param params - Query params selecting either products or coins.
   * @returns An unexecuted {@link Query} typed by the requested columns.
   * @throws If the params fail validation.
   */
  query<C extends Column<T>>(
    params: RowsParamsProducts<T, C> | RowsParamsCoins<T, C>,
  ): Query<Row<C>> {
    return new Query(this.http, prepareRows(this.type, params));
  }
}

/* The options market: `/rows` queries plus the term structure. */
export class OptionsMarket extends Market<"options"> {
  /**
   * @param http - The transport requests are sent through.
   */
  constructor(http: Http) {
    super(http, "options");
  }

  /**
   * Creates an options term-structure query (`/api/v1/terms`), validated;
   * nothing is sent until execute() or stream().
   *
   * @param params - The terms params; only BTC and ETH are supported.
   * @returns An unexecuted {@link Query} over the term-structure points.
   * @throws If `coins` is empty or contains an unsupported coin.
   */
  terms(params: TermsParams): Query<TermPoint> {
    return new Query(this.http, prepareTerms(params));
  }
}
