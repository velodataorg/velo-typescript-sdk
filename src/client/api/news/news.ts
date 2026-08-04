import type { WebSocketTransport } from "../../../transport/websocket.ts";
import type { QueryFactory } from "../../plan.ts";
import { NewsStoriesBuilder } from "./builder.ts";
import type { NewsStoriesParams } from "./params.ts";
import { NewsWatcherController } from "./watcher.ts";
import type { NewsWatcher, NewsWatchOptions } from "./watcher.ts";

/** The news namespace exposed by {@link Velo}. */
export class News {
  readonly #query: QueryFactory<"news.stories">;
  readonly watch: (options?: NewsWatchOptions) => NewsWatcher;

  constructor(query: QueryFactory<"news.stories">, webSocket: WebSocketTransport) {
    this.#query = query;
    this.watch = (options = {}) => new NewsWatcherController(webSocket, options);
  }

  /** Creates an immutable historical-news builder bound to this client. */
  stories(params: NewsStoriesParams = {}): NewsStoriesBuilder {
    return new NewsStoriesBuilder(params, this.#query);
  }
}
