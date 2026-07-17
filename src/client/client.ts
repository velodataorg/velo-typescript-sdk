import { Http } from "../transport/http.js";
import type { HttpConfig } from "../transport/http.js";
import { WebSocketTransport } from "../transport/websocket.js";
import type { WebSocketFactory } from "../transport/websocket.js";
import type { CapsParams, MarketCap } from "./caps/caps.js";
import { prepareCaps } from "./caps/caps.js";
import type { Catalog } from "./catalog/catalog.js";
import { createCatalog } from "./catalog/catalog.js";
import type { News } from "./news/news.js";
import { createNews } from "./news/news.js";
import { Query } from "./query.js";
import type { RowsParams } from "./rows/params.js";
import { prepareRows } from "./rows/prepare.js";
import type { Row } from "./rows/result.js";
import type { Column, MarketType } from "./rows/types.js";
import type { TermPoint, TermsParams } from "./terms/terms.js";
import { prepareTerms } from "./terms/terms.js";

export interface VeloConfig extends HttpConfig {
  /* Overrides runtime WebSocket creation, primarily for custom runtimes and tests. */
  readonly webSocketFactory?: WebSocketFactory;
}

export class Velo {
  readonly #futures: Market<"futures">;
  readonly #spot: Market<"spot">;
  readonly #options: OptionsMarket;
  readonly #catalog: Catalog;
  readonly #news: News;
  readonly #http: Http;

  constructor(config: VeloConfig) {
    this.#http = new Http(config);
    const webSocket = new WebSocketTransport(config, config.webSocketFactory);
    this.#news = createNews(this.#http, webSocket);
    this.#catalog = createCatalog(this.#http);
    this.#futures = this.#market("futures");
    this.#spot = this.#market("spot");
    this.#options = {
      ...this.#market("options"),
      terms: (params) => new Query(this.#http, prepareTerms(params)),
    };
  }

  get futures(): Market<"futures"> {
    return this.#futures;
  }

  get spot(): Market<"spot"> {
    return this.#spot;
  }

  get options(): OptionsMarket {
    return this.#options;
  }

  get news(): News {
    return this.#news;
  }

  get catalog(): Catalog {
    return this.#catalog;
  }

  /**
   * Creates a market-caps query (`/api/v1/caps`).
   *
   * @param params - The caps params.
   * @returns An unexecuted {@link Query} over the market caps.
   * @throws If `coins` is empty or not an array of non-empty strings.
   */
  caps(params: CapsParams): Query<MarketCap> {
    return new Query(this.#http, prepareCaps(params));
  }

  /**
   * Binds the transport to one market namespace.
   *
   * @param type - The market namespace to query.
   * @returns The namespace object.
   */
  #market<T extends MarketType>(type: T): Market<T> {
    return {
      query: (params) => new Query(this.#http, prepareRows(type, params)),
    };
  }
}

/**
 * Entry point for querying one market namespace.
 *
 * @typeParam T - The market namespace this instance queries.
 */
export interface Market<T extends MarketType> {
  /**
   * Creates a market-data query (`/api/v1/rows`).
   *
   * @param params - Query params selecting either products or coins.
   * @returns An unexecuted {@link Query} typed by the requested columns.
   * @throws If the params fail validation.
   */
  query<C extends Column<T>>(params: RowsParams<T, C>): Query<Row<C>>;
}

/* The options market: `/rows` queries plus the term structure. */
export interface OptionsMarket extends Market<"options"> {
  /**
   * Creates an options term-structure query (`/api/v1/terms`).
   *
   * @param params - The terms params; only BTC and ETH are supported.
   * @returns An unexecuted {@link Query} over the term-structure points.
   * @throws If `coins` is empty or contains an unsupported coin.
   */
  terms(params: TermsParams): Query<TermPoint>;
}
