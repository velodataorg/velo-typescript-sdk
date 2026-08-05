import { NewsFeedBuilder, NewsStoriesBuilder } from "./builder.ts";
import type { NewsStoriesParams } from "./params.ts";

/** The news namespace exposed by {@link Velo}. */
export class News {
  /** Creates an immutable historical-news request builder. */
  stories(params?: NewsStoriesParams): NewsStoriesBuilder {
    return new NewsStoriesBuilder(params);
  }

  /** Creates an immutable live-news subscription builder. */
  feed(): NewsFeedBuilder {
    return new NewsFeedBuilder();
  }
}
