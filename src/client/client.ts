import { Http } from "../transport/http.js";
import type { HttpConfig } from "../transport/http.js";
import { WebSocketTransport } from "../transport/websocket.js";
import type { WebSocketFactory } from "../transport/websocket.js";
import type { Caps } from "./caps/caps.js";
import { createCaps } from "./caps/caps.js";
import type { Catalog } from "./catalog/catalog.js";
import { createCatalog } from "./catalog/catalog.js";
import type { News } from "./news/news.js";
import { createNews } from "./news/news.js";
import type { Futures } from "./rows/futures/futures.js";
import { createFutures } from "./rows/futures/futures.js";
import type { Options } from "./rows/options/options.js";
import { createOptions } from "./rows/options/options.js";
import type { Spot } from "./rows/spot/spot.js";
import { createSpot } from "./rows/spot/spot.js";

export interface VeloConfig extends HttpConfig {
  /* Overrides runtime WebSocket creation, primarily for custom runtimes and tests. */
  readonly webSocketFactory?: WebSocketFactory;
}

export class Velo {
  readonly #http: Http;
  readonly #caps: Caps;
  readonly #catalog: Catalog;
  readonly #news: News;
  readonly #futures: Futures;
  readonly #options: Options;
  readonly #spot: Spot;

  constructor(config: VeloConfig) {
    this.#http = new Http(config);
    const webSocket = new WebSocketTransport(config, config.webSocketFactory);
    this.#caps = createCaps(this.#http);
    this.#catalog = createCatalog(this.#http);
    this.#news = createNews(this.#http, webSocket);
    this.#futures = createFutures(this.#http);
    this.#options = createOptions(this.#http);
    this.#spot = createSpot(this.#http);
  }

  get caps(): Caps {
    return this.#caps;
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

  get spot(): Spot {
    return this.#spot;
  }
}
