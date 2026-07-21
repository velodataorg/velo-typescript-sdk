import { Http } from "../transport/http.js";
import type { HttpConfig } from "../transport/http.js";
import { WebSocketTransport } from "../transport/websocket.js";
import type { WebSocketFactory } from "../transport/websocket.js";
import type { Caps } from "./routes/caps/caps.js";
import { createCaps } from "./routes/caps/caps.js";
import type { Catalog } from "./routes/catalog/catalog.js";
import { createCatalog } from "./routes/catalog/catalog.js";
import type { News } from "./routes/news/news.js";
import { createNews } from "./routes/news/news.js";
import { Futures } from "./routes/rows/futures/futures.js";
import type { Options } from "./routes/rows/options/options.js";
import { createOptions } from "./routes/rows/options/options.js";
import type { Spot } from "./routes/rows/spot/spot.js";
import { createSpot } from "./routes/rows/spot/spot.js";

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
    this.#futures = new Futures(this.#http);
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
