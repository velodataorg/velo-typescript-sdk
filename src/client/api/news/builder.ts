import type { QueryBuilder, QueryRequest } from "../../query/plan.ts";
import type { WatchBuilder, WatchRequest } from "../../watch/registry.ts";
import { NewsStoriesParams } from "./params.ts";

/** An immutable live-news subscription builder. */
export class NewsFeedBuilder implements WatchBuilder<"news.feed"> {
  readonly #request: WatchRequest<"news.feed">;

  constructor() {
    this.#request = Object.freeze({ kind: "news.feed", params: Object.freeze({}) });
  }

  /** Returns the immutable transport-independent subscription request. */
  build(): WatchRequest<"news.feed"> {
    return this.#request;
  }
}

/** An immutable historical-news request builder. */
export class NewsStoriesBuilder implements QueryBuilder<"news.stories"> {
  readonly #request: QueryRequest<"news.stories">;

  constructor(params?: NewsStoriesParams) {
    const snapshot = Object.freeze(NewsStoriesParams.parse(params));
    this.#request = Object.freeze({ kind: "news.stories", params: snapshot });
  }

  /** Returns the immutable transport-independent endpoint request. */
  build(): QueryRequest<"news.stories"> {
    return this.#request;
  }
}
