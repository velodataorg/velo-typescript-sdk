import type { WebSocketTransport } from "../../../transport/websocket.ts";
import { NewsStoriesBuilder, type NewsQueryFactory } from "./builder.ts";
import type { NewsStoriesParams } from "./params.ts";
import { NewsWatcherController } from "./watcher.ts";
import type { NewsWatcher, NewsWatchOptions } from "./watcher.ts";

/** The news namespace exposed by {@link Velo}. */
export class News {
  readonly #query: NewsQueryFactory;
  readonly watch: (options?: NewsWatchOptions) => NewsWatcher;

  constructor(query: NewsQueryFactory, webSocket: WebSocketTransport) {
    this.#query = query;
    this.watch = (options = {}) => new NewsWatcherController(webSocket, options);
  }

  /** Creates an immutable historical-news builder bound to this client. */
  stories(params: NewsStoriesParams = {}): NewsStoriesBuilder {
    return new NewsStoriesBuilder(params, this.#query);
  }
}
