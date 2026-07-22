import { z } from "zod";

import { NEWS_PATH } from "../../../constants.js";
import { VeloError } from "../../../errors.js";
import type { Http, HttpParams, HttpRequestOptions } from "../../../transport/http.js";
import { assert } from "../../../util/assert.js";
import { newsResponseSchema, type NewsStory } from "./schema.js";

/** Parameters for fetching historical news stories. */
export interface NewsStoriesParams {
  /** Only returns stories published after this millisecond timestamp. Defaults to `0`. */
  readonly begin?: number;
}

/** Fetches validated historical news stories through an HTTP transport. */
export class NewsQuery {
  readonly #http: Http;

  constructor(http: Http) {
    this.#http = http;
  }

  /** Fetches historical news stories from raw parameters. */
  build(params: NewsStoriesParams = {}, options?: HttpRequestOptions): Promise<NewsStory[]> {
    const request = prepareNewsStories(params);
    return this.#http.json(NEWS_PATH, request, options).then(decodeNewsStories);
  }
}

/** Validates and lowers historical-news params to wire form. */
export function prepareNewsStories(params: NewsStoriesParams): HttpParams {
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
}

/**
 * Validates a historical News response and returns its known story fields.
 *
 * Unknown fields are ignored so additive server changes remain compatible.
 */
function decodeNewsStories(value: unknown): NewsStory[] {
  const result = newsResponseSchema.safeParse(value);
  if (!result.success) {
    throw new VeloError(`unexpected ${NEWS_PATH} response:\n${z.prettifyError(result.error)}`, {
      cause: result.error,
    });
  }
  return result.data.stories;
}
