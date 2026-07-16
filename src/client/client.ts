import { Http } from "../transport/http.js";
import type { HttpConfig } from "../transport/http.js";
import type { CapsParams, MarketCap } from "./caps/caps.js";
import { prepareCaps } from "./caps/caps.js";
import { Market, OptionsMarket } from "./market.js";
import { Query } from "./query.js";

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

  /**
   * Creates a market-caps query (`/api/v1/caps`), validated; nothing is sent
   * until execute() or stream().
   *
   * @param params - The caps params.
   * @returns An unexecuted {@link Query} over the market caps.
   * @throws If `coins` is empty or not an array of non-empty strings.
   */
  caps(params: CapsParams): Query<MarketCap> {
    return new Query(this.http, prepareCaps(params));
  }
}
