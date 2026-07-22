import { Http } from "../transport/http.js";
import type { HttpConfig } from "../transport/http.js";
import { WebSocketTransport } from "../transport/websocket.js";
import type { WebSocketFactory } from "../transport/websocket.js";
import { Caps } from "./routes/caps/caps.js";
import { Catalog } from "./routes/catalog/catalog.js";
import { News } from "./routes/news/news.js";
import { Futures } from "./routes/rows/futures/futures.js";
import { Options } from "./routes/rows/options/options.js";
import { Spot } from "./routes/rows/spot/spot.js";

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
    this.#caps = new Caps(this.#http);
    this.#catalog = new Catalog(this.#http);
    this.#news = new News(this.#http, webSocket);
    this.#futures = new Futures(this.#http);
    this.#options = new Options(this.#http);
    this.#spot = new Spot(this.#http);
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
