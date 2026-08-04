import type { HttpRequestOptions } from "../../../transport/http.ts";
import type { Query } from "../../common/query.ts";
import type { QueryBuilder, QueryRequest } from "../../plan.ts";
import { NewsStoriesParams } from "./params.ts";
import type { NewsStory } from "./validation.ts";

/** Binds a historical-news request to the central lazy-query constructor. */
export type NewsQueryFactory = (
  request: QueryRequest<"news.stories">,
) => Query<NewsStory, NewsStory[]>;

/** An immutable historical-news request builder bound to one client. */
export class NewsStoriesBuilder implements QueryBuilder<"news.stories"> {
  readonly #request: QueryRequest<"news.stories">;
  readonly #query: NewsQueryFactory;

  constructor(params: NewsStoriesParams, query: NewsQueryFactory) {
    const snapshot = Object.freeze(NewsStoriesParams.parse(params));
    this.#request = Object.freeze({ kind: "news.stories", params: snapshot });
    this.#query = query;
  }

  /** Returns the immutable transport-independent endpoint request. */
  build(): QueryRequest<"news.stories"> {
    return this.#request;
  }

  /** Creates and immediately executes a lazy query through the bound client. */
  fetch(options?: HttpRequestOptions): Promise<NewsStory[]> {
    return this.#query(this.#request).execute(options);
  }

  /** Creates a lazy query and streams stories through the bound client. */
  stream(options?: HttpRequestOptions): AsyncIterable<NewsStory> {
    return this.#query(this.#request).stream(options);
  }
}
