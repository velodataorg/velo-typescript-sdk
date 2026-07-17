import { z } from "zod";

import { NEWS_PATH } from "../../constants.js";
import { VeloError } from "../../errors.js";
import type { Http, HttpParams, RequestOptions } from "../../transport/http.js";
import { assert } from "../../util/assert.js";

const TimestampSchema = z.int().nonnegative();

const NewsStorySchema = z.object({
  id: z.int(),
  time: TimestampSchema,
  effectiveTime: TimestampSchema,
  effectivePrice: z.number().nullable(),
  headline: z.string(),
  source: z.string().nullable(),
  priority: z.int(),
  coins: z.array(z.string()),
  summary: z.string().nullable(),
  link: z.string().nullable(),
});

const NewsResponseSchema = z.object({
  stories: z.array(NewsStorySchema),
});

/* Parameters for fetching historical news stories. */
export interface NewsStoriesParams {
  /* Only return stories published after this millisecond timestamp. Defaults to 0. */
  readonly begin?: number;
}

/* One historical news story returned by `/api/n/news`. */
export type NewsStory = z.infer<typeof NewsStorySchema>;

/* Entry point for the News API. */
export interface News {
  /**
   * Fetches historical news stories (`/api/n/news`).
   *
   * @param params - Optional publication-time lower bound.
   * @param options - Per-request transport options.
   * @returns The validated stories.
   * @throws Synchronously if `begin` is not a valid millisecond timestamp;
   * rejects if the request fails or the response does not match the contract.
   */
  stories(params?: NewsStoriesParams, options?: RequestOptions): Promise<NewsStory[]>;
}

/**
 * Binds the News namespace to an HTTP transport.
 *
 * @param http - The authenticated transport.
 * @returns The News namespace.
 */
export function createNews(http: Http): News {
  return {
    stories(params = {}, options) {
      const request = prepareNewsStories(params);
      return http.json(NEWS_PATH, request, options).then(decodeNewsStories);
    },
  };
}

/**
 * Validates and lowers historical-news params to wire form.
 *
 * @param params - The caller's params.
 * @returns A fresh request snapshot; an omitted begin uses the server default.
 * @throws If params is not an object or begin is not a valid timestamp.
 */
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
 * Validates the JSON response and copies its known story fields.
 *
 * Unknown object fields are ignored so additive server changes remain
 * forwards-compatible, while every documented field is still required and
 * type-checked.
 *
 * @param value - The parsed JSON response.
 * @returns The validated stories.
 * @throws If the response does not match the News contract.
 */
export function decodeNewsStories(value: unknown): NewsStory[] {
  const result = NewsResponseSchema.safeParse(value);
  if (!result.success) {
    throw new VeloError(`unexpected ${NEWS_PATH} response:\n${z.prettifyError(result.error)}`, {
      cause: result.error,
    });
  } else {
    return result.data.stories;
  }
}
