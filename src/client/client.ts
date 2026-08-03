import { Http } from "../transport/http.ts";
import type { HttpConfig } from "../transport/http.ts";
import { WebSocketTransport } from "../transport/websocket.ts";
import type { WebSocketFactory } from "../transport/websocket.ts";
import { Catalog } from "./api/catalog/catalog.ts";
import { Futures } from "./api/futures/futures.ts";
import { MarketCaps } from "./api/market-caps/market-caps.ts";
import { News } from "./api/news/news.ts";
import { Options } from "./api/options/options.ts";
import { Orderbook } from "./api/orderbook/orderbook.ts";
import { Spot } from "./api/spot/spot.ts";
import { Status } from "./api/status/status.ts";

export interface VeloConfig extends HttpConfig {
  /* Overrides runtime WebSocket creation, primarily for custom runtimes and tests. */
  readonly webSocketFactory?: WebSocketFactory;
}

export class Velo {
  readonly #http: Http;
  readonly #marketCaps: MarketCaps;
  readonly #catalog: Catalog;
  readonly #news: News;
  readonly #futures: Futures;
  readonly #options: Options;
  readonly #orderbook: Orderbook;
  readonly #spot: Spot;
  readonly #status: Status;

  constructor(config: VeloConfig) {
    this.#http = new Http(config);
    const webSocket = new WebSocketTransport(config, config.webSocketFactory);
    this.#marketCaps = new MarketCaps(this.#http);
    this.#catalog = new Catalog(this.#http);
    this.#news = new News(this.#http, webSocket);
    this.#futures = new Futures(this.#http);
    this.#options = new Options(this.#http);
    this.#orderbook = new Orderbook(this.#http);
    this.#spot = new Spot(this.#http);
    this.#status = new Status(this.#http);
  }

  get marketCaps(): MarketCaps {
    return this.#marketCaps;
  }

  get catalog(): Catalog {
    return this.#catalog;
  }

  get news(): News {
    return this.#news;
  }

  get futures(): Futures {
    return this.#futures;
  }

  get options(): Options {
    return this.#options;
  }

  get orderbook(): Orderbook {
    return this.#orderbook;
  }

  get spot(): Spot {
    return this.#spot;
  }

  get status(): Status {
    return this.#status;
  }
}
