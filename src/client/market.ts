import type { MarketType, TermsCoin } from "../constants.js";
import { TERMS_COINS, TERMS_PATH } from "../constants.js";
import type { Http, RequestOptions } from "../transport/http.js";
import { assert } from "../util/assert.js";
import { decodeCsv } from "../util/csv.js";
import type { Column, QueryParamsCoins, QueryParamsProducts } from "./query-params.js";
import { Query } from "./query.js";
import type { TermPoint } from "./result.js";
import { TERMS_SCHEMA } from "./result.js";

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
   * Creates a market-data query (`/api/v1/rows`).
   *
   * @param params - Query params selecting either products or coins.
   * @returns An unexecuted {@link Query} typed by the requested columns.
   * @throws If the params fail validation.
   */
  query<C extends Column<T>>(params: QueryParamsProducts<T, C> | QueryParamsCoins<T, C>): Query<C> {
    return new Query(this.http, { ...params, type: this.type });
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
   * Queries the options term structure (`/api/v1/terms`).
   *
   * @param coins - Coins to fetch the term structure for; only BTC and ETH
   * are supported.
   * @param options - Per-request transport options.
   * @returns The term-structure points for the requested coins.
   * @throws If `coins` is empty or contains an unsupported coin.
   */
  async terms(coins: readonly TermsCoin[], options?: RequestOptions): Promise<TermPoint[]> {
    assert(coins.length > 0, "coins must not be empty");
    assert(
      coins.every((coin) => TERMS_COINS.includes(coin)),
      `terms coins must be among ${TERMS_COINS.join(", ")}`,
    );
    const body = await this.http.text(TERMS_PATH, { coins }, options);
    // The cast is sound: decodeCsv validated every field against the schema.
    return decodeCsv(body, TERMS_SCHEMA, TERMS_PATH) as TermPoint[];
  }
}
