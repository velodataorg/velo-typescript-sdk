import type { Http } from "../../../transport/http.ts";
import type { WebSocketTransport } from "../../../transport/websocket.ts";
import { NewsQuery } from "./stories.ts";
import { NewsWatcherController } from "./watcher.ts";
import type { NewsWatcher, NewsWatchOptions } from "./watcher.ts";

/** The news namespace exposed by {@link Velo}. */
export class News {
  readonly stories: NewsQuery["build"];
  readonly watch: (options?: NewsWatchOptions) => NewsWatcher;

  constructor(http: Http, webSocket: WebSocketTransport) {
    const query = new NewsQuery(http);
    this.stories = query.build.bind(query);
    this.watch = (options = {}) => new NewsWatcherController(webSocket, options);
  }
}
