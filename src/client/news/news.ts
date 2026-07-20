import { z } from "zod";

import { NEWS_PATH } from "../../constants.js";
import { VeloError } from "../../errors.js";
import type { Http, HttpParams, HttpRequestOptions } from "../../transport/http.js";
import type { WebSocketTransport } from "../../transport/websocket.js";
import { assert } from "../../util/assert.js";
import { NewsResponseSchema } from "./schema.js";
import type { NewsStory } from "./schema.js";
import { NewsWatcherController } from "./watch.js";
import type { NewsWatcher, NewsWatchOptions } from "./watch.js";

export type { NewsStory } from "./schema.js";
export type {
  NewsClose,
  NewsDelete,
  NewsWatcher,
  NewsWatcherEvents,
  NewsWatcherListener,
  NewsWatcherState,
  NewsWatchOptions,
} from "./watch.js";

/* Parameters for fetching historical news stories. */
export interface NewsStoriesParams {
  /* Only return stories published after this millisecond timestamp. Defaults to 0. */
  readonly begin?: number;
}

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
  stories(params?: NewsStoriesParams, options?: HttpRequestOptions): Promise<NewsStory[]>;

  /**
   * Creates a disconnected watcher for validated live News events.
   *
   * Register listeners with `on()` before explicitly calling `connect()`.
   * The watcher owns one socket and cannot reconnect after it closes.
   *
   * @param options - Cancellation and heartbeat-timeout options.
   * @returns A disconnected watcher for new, edited, and deleted stories.
   */
  watch(options?: NewsWatchOptions): NewsWatcher;
}

/**
 * Binds the News namespace to authenticated HTTP and WebSocket transports.
 */
export function createNews(http: Http, webSocket: WebSocketTransport): News {
  return {
    stories(params = {}, options) {
      const request = prepareNewsStories(params);
      return http.json(NEWS_PATH, request, options).then(decodeNewsStories);
    },
    watch(options = {}) {
      return new NewsWatcherController(webSocket, options);
    },
  };
}

/**
 * Validates and lowers historical-news params to wire form.
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
 * Validates a historical News response and returns its known story fields.
 *
 * Unknown fields are ignored so additive server changes remain compatible.
 */
function decodeNewsStories(value: unknown): NewsStory[] {
  const result = NewsResponseSchema.safeParse(value);
  if (!result.success) {
    throw new VeloError(`unexpected ${NEWS_PATH} response:\n${z.prettifyError(result.error)}`, {
      cause: result.error,
    });
  }
  return result.data.stories;
}
