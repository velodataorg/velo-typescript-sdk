import { Http } from "../transport/http.js";
import type { HttpConfig, RequestOptions } from "../transport/http.js";
import { assert } from "../util/assert.js";
import { assertColumns, parseCsv } from "../util/csv.js";
import { Market, OptionsMarket } from "./market.js";
import type { CapsRow } from "./row.js";
import { CAPS_COLUMNS } from "./row.js";

export type VeloConfig = HttpConfig;

export class Velo {
  readonly futures: Market<"futures">;
  readonly options: OptionsMarket;
  readonly spot: Market<"spot">;
  private readonly http: Http;

  constructor(config: VeloConfig) {
    this.http = new Http(config);
    this.futures = new Market(this.http, "futures");
    this.options = new OptionsMarket(this.http);
    this.spot = new Market(this.http, "spot");
  }

  /** Query market caps (/api/v1/caps). */
  async caps(coins: readonly string[], options?: RequestOptions): Promise<CapsRow[]> {
    assert(coins.length > 0, "coins must not be empty");
    const body = await this.http.text("/api/v1/caps", { coins }, options);
    const { columns, rows } = parseCsv(body);
    assertColumns(columns, CAPS_COLUMNS, "/api/v1/caps");
    return rows as CapsRow[];
  }
}
