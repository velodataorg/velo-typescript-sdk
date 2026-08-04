import type { WebSocketTransport } from "../../../transport/websocket.ts";
import { NewsStoriesBuilder } from "./builder.ts";
import type { NewsStoriesParams } from "./params.ts";
import { NewsWatcherController } from "./watcher.ts";
import type { NewsWatcher, NewsWatchOptions } from "./watcher.ts";

/** The news namespace exposed by {@link Velo}. */
export class News {
  readonly watch: (options?: NewsWatchOptions) => NewsWatcher;

  constructor(webSocket: WebSocketTransport) {
    this.watch = (options = {}) => new NewsWatcherController(webSocket, options);
  }

  /** Creates an immutable historical-news request builder. */
  stories(params: NewsStoriesParams = {}): NewsStoriesBuilder {
    return new NewsStoriesBuilder(params);
  }
}
