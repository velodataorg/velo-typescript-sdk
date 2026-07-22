import type { Http } from "../../../transport/http.js";
import type { WebSocketTransport } from "../../../transport/websocket.js";
import { NewsQuery } from "./stories.js";
import { NewsWatcherController } from "./watcher.js";
import type { NewsWatcher, NewsWatchOptions } from "./watcher.js";

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
