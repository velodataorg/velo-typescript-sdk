import { Http } from "../transport/http.ts";
import type { HttpConfig, HttpRequestOptions } from "../transport/http.ts";
import { WebSocketTransport } from "../transport/websocket.ts";
import type { WebSocketFactory } from "../transport/websocket.ts";
import { assert } from "../util/assert.ts";
import type { Catalog } from "./api/catalog/catalog.ts";
import type { Futures } from "./api/futures/futures.ts";
import type { MarketCaps } from "./api/market-caps/market-caps.ts";
import type { News } from "./api/news/news.ts";
import type { Options } from "./api/options/options.ts";
import type { Orderbook } from "./api/orderbook/orderbook.ts";
import type { Spot } from "./api/spot/spot.ts";
import { Status } from "./api/status/status.ts";
import { catalog, futures, marketCaps, news, options, orderbook, spot } from "./builders.ts";
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
} from "./watch/registry.ts";
import { prepareReconnect, resumeOnDrop } from "./watch/resume.ts";
import { attachWatchListeners } from "./watch/watcher.ts";

export interface VeloConfig extends HttpConfig {
  /* Overrides runtime WebSocket creation, primarily for custom runtimes and tests. */
  readonly webSocketFactory?: WebSocketFactory;
}

export class Velo {
  readonly #http: Http;
  readonly #status: Status;
  readonly #webSocket: WebSocketTransport;

  constructor(config: VeloConfig) {
    this.#http = new Http(config);
    this.#webSocket = new WebSocketTransport(config, config.webSocketFactory);
    this.#status = new Status(this.#http);
  }

  get marketCaps(): MarketCaps {
    return marketCaps;
  }

  get catalog(): Catalog {
    return catalog;
  }

  get news(): News {
    return news;
  }

  get futures(): Futures {
    return futures;
  }

  get options(): Options {
    return options;
  }

  get orderbook(): Orderbook {
    return orderbook;
  }

  get spot(): Spot {
    return spot;
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
    options?: WatchOptions<K>,
  ): Promise<Watcher<K>> {
    /* Omitted is valid; null or a non-object is not. */
    assert(
      options === undefined ||
        (options !== null && typeof options === "object" && !Array.isArray(options)),
      "watch options must be an object",
    );

    const retry = prepareReconnect(options?.reconnect);
    const request = toRequest(input);
    const definition = WATCHERS[request.kind];

    /* Options are a superset of what the factory takes, so they pass through
     * without narrowing: the extra keys belong to the watch layer.
     */
    const watcher = definition.create(this.#webSocket, options);

    if (options?.on) attachWatchListeners(watcher, definition.events, options.on);
    if (retry) resumeOnDrop(watcher, retry);

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
