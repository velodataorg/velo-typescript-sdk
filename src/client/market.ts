import type { MarketType, TermsCoin } from "../constants.js";
import { TERMS_COINS } from "../constants.js";
import type { Http, RequestOptions } from "../transport/http.js";
import { assert } from "../util/assert.js";
import { assertColumns, parseCsv } from "../util/csv.js";
import type { ColumnFor, QueryParamsCoins, QueryParamsProducts } from "./param.js";
import { Query } from "./query.js";
import type { TermsRow } from "./row.js";
import { TERMS_COLUMNS } from "./row.js";

/** One market's slice of the API: /rows queries typed to that market's columns. */
export class Market<T extends MarketType> {
  protected readonly http: Http;
  private readonly type: T;

  constructor(http: Http, type: T) {
    this.http = http;
    this.type = type;
  }

  /**
   * Create a market-data query (/api/v1/rows). The params are validated here;
   * nothing is sent until `execute()`.
   *
   * Rows are typed by the requested columns: pass a columns literal and each
   * row is the base columns plus exactly those fields. A pre-widened array
   * (e.g. `FuturesColumn[]`) degrades to rows typed with every column.
   */
  query<C extends ColumnFor<T>>(
    params: QueryParamsProducts<T, C> | QueryParamsCoins<T, C>,
  ): Query<C> {
    return new Query(this.http, { type: this.type, ...params });
  }
}

/** The options market: /rows queries plus the term structure. */
export class OptionsMarket extends Market<"options"> {
  constructor(http: Http) {
    super(http, "options");
  }

  /** Query the options term structure (/api/v1/terms). Only BTC and ETH are supported. */
  async terms(coins: readonly TermsCoin[], options?: RequestOptions): Promise<TermsRow[]> {
    assert(coins.length > 0, "coins must not be empty");
    assert(
      coins.every((coin) => TERMS_COINS.includes(coin)),
      `terms coins must be among ${TERMS_COINS.join(", ")}`,
    );
    const body = await this.http.text("/api/v1/terms", { coins }, options);
    const { columns, rows } = parseCsv(body);
    assertColumns(columns, TERMS_COLUMNS, "/api/v1/terms");
    return rows as TermsRow[];
  }
}
