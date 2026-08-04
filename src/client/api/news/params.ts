import { assert } from "../../../util/assert.ts";

/** Parameters for fetching historical news stories. */
export interface NewsStoriesParams {
  /** Only returns stories published after this millisecond timestamp. Defaults to `0`. */
  readonly begin?: number;
}

export const NewsStoriesParams = Object.freeze({
  /** Validates and snapshots historical-news parameters. */
  parse(params?: NewsStoriesParams): NewsStoriesParams {
    if (params === undefined) return {};
    assert(
      params !== null && typeof params === "object" && !Array.isArray(params),
      "news stories params must be an object",
    );

    const { begin } = params;
    if (begin === undefined) return {};
    assert(
      Number.isSafeInteger(begin) && begin >= 0,
      () => `invalid begin ${String(begin)}: must be a millisecond timestamp`,
    );
    return { begin };
  },
});
