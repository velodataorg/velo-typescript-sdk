import { Http } from "../transport/http.ts";
import type { HttpConfig, HttpRequestOptions } from "../transport/http.ts";
import { WebSocketTransport } from "../transport/websocket.ts";
import type { WebSocketFactory } from "../transport/websocket.ts";
import { assert } from "../util/assert.ts";
import { Catalog } from "./api/catalog/catalog.ts";
import { Futures } from "./api/futures/futures.ts";
import { MarketCaps } from "./api/market-caps/market-caps.ts";
import { News } from "./api/news/news.ts";
import { Options } from "./api/options/options.ts";
import { Orderbook } from "./api/orderbook/orderbook.ts";
import { Spot } from "./api/spot/spot.ts";
import { Status } from "./api/status/status.ts";
import { Query } from "./common/query.ts";
import { toRequest } from "./common/request.ts";
import {
  plan,
  type QueryInput,
  type QueryItem,
  type QueryKind,
  type QueryParams,
  type QueryResult,
  type StreamableKind,
  toQueryRequest,
} from "./plan.ts";
import {
  WATCHERS,
  type WatchableKind,
  type Watcher,
  type WatchInput,
  type WatchOptions,
  type WatchParams,
} from "./watch.ts";

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
  readonly #webSocket: WebSocketTransport;

  constructor(config: VeloConfig) {
    this.#http = new Http(config);
    this.#webSocket = new WebSocketTransport(config, config.webSocketFactory);
    this.#marketCaps = new MarketCaps();
    this.#catalog = new Catalog();
    this.#news = new News();
    this.#futures = new Futures();
    this.#options = new Options();
    this.#orderbook = new Orderbook();
    this.#spot = new Spot();
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

  /**
   * Binds an endpoint request or builder to this client as an immutable lazy query.
   *
   * @param input - A direct endpoint request or completed request builder.
   * @param options - Default transport options used when the query is awaited or streamed.
   */
  query<K extends QueryKind, P extends QueryParams<K>>(
    input: QueryInput<K, P>,
    options?: HttpRequestOptions,
  ): Promise<QueryResult<K, P>> {
    return this.#build(input, options).execute();
  }

  /**
   * Streams an endpoint request or builder, yielding decoded items in request
   * order without collecting them into a result.
   *
   * Each call executes the request once; streaming the same input twice sends
   * its requests twice.
   *
   * @param input - A direct endpoint request or completed request builder.
   * @param options - Per-request transport options.
   */
  stream<K extends StreamableKind, P extends QueryParams<K>>(
    input: QueryInput<K, P>,
    options?: HttpRequestOptions,
  ): AsyncGenerator<QueryItem<K, P>, void, undefined> {
    return this.#build(input, options).stream();
  }

  /**
   * Opens a live subscription for a subscription request or builder.
   *
   * Executes, as `query()` does: the socket opens immediately and the promise
   * resolves once the subscription is live. Listeners supplied through
   * `options.on` are attached first, so no event can arrive unobserved.
   *
   * The resolved watcher stays reusable — `connect()` reopens it after an
   * unexpected disconnect.
   *
   * @param input - A subscription request or builder.
   * @param options - Subscription options and the listeners to attach.
   */
  watch<K extends WatchableKind, P extends WatchParams<K>>(
    input: WatchInput<K, P>,
    options: WatchOptions<K> = {},
  ): Promise<Watcher<K>> {
    assert(
      options !== null && typeof options === "object" && !Array.isArray(options),
      "watch options must be an object",
    );

    const { on, ...watchOptions } = options;
    const request = toRequest(input);
    /* Indexing the registry with a generic kind loses the tie between a
     * definition and its own options type; removing `on` leaves exactly the
     * options that kind's factory accepts.
     */
    const definition = WATCHERS[request.kind] as {
      create(transport: WebSocketTransport, options: WatchOptions<K>): Watcher<K>;
      readonly events: Readonly<Record<string, true>>;
    };
    const watcher = definition.create(this.#webSocket, watchOptions as WatchOptions<K>);

    if (typeof on === "function") {
      /* One listener for everything: re-tag each event so the callback can
       * discriminate on `type`.
       */
      for (const type of Object.keys(definition.events)) {
        watcher.on(type as never, ((event: unknown) => on({ type, event } as never)) as never);
      }
    } else if (on) {
      for (const [type, listener] of Object.entries(on)) {
        watcher.on(type as never, listener as never);
      }
    }

    /* Not an async method: options are validated synchronously, so a bad
     * call throws where it is written rather than on await.
     */
    return watcher.connect().then(() => watcher);
  }

  /** Lowers a request or builder into a transport-bound query. */
  #build<K extends QueryKind, P extends QueryParams<K>>(
    input: QueryInput<K, P>,
    options?: HttpRequestOptions,
  ): Query<QueryItem<K, P>, QueryResult<K, P>> {
    return new Query(this.#http, plan(toQueryRequest(input)), options);
  }
}
