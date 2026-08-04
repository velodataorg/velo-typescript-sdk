import type { QueryBuilder, QueryRequest } from "../../plan.ts";
import { NewsStoriesParams } from "./params.ts";

/** An immutable historical-news request builder. */
export class NewsStoriesBuilder implements QueryBuilder<"news.stories"> {
  readonly #request: QueryRequest<"news.stories">;

  constructor(params: NewsStoriesParams) {
    const snapshot = Object.freeze(NewsStoriesParams.parse(params));
    this.#request = Object.freeze({ kind: "news.stories", params: snapshot });
  }

  /** Returns the immutable transport-independent endpoint request. */
  build(): QueryRequest<"news.stories"> {
    return this.#request;
  }
}
