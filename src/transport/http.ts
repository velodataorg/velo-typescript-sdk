// HTTP transport for the Velo API: basic auth, query building (query-string),
// typed errors, and per-attempt timeouts, with the retry policy from retry.ts.
// No Node builtins — only web-standard APIs (fetch, AbortSignal, btoa) — so it
// runs on Node >=22, Bun, Deno, and edge runtimes.

import queryString from "query-string";

import { version } from "../../package.json";
import { BASE_URL } from "../constants.js";
import { toConnectionError, toError, VeloError } from "./error.js";
import { backoffMs, DEFAULT_RETRY, isRetryable, retryAfterMs, sleep } from "./retry.js";
import type { RetryOptions } from "./retry.js";

const USER_AGENT = `velo-sdk/${version}`;

/** Per-attempt timeout in milliseconds; a slow attempt is aborted and retried without eating the retry budget. */
export const DEFAULT_TIMEOUT = 60_000;

export interface HttpConfig {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  retry?: Partial<RetryOptions>;
  timeout?: number;
}

export interface RequestOptions {
  signal?: AbortSignal;
  timeout?: number;
  retry?: Partial<RetryOptions>;
}

/** Values are serialized into the query string; arrays are comma-joined; undefined is skipped. */
export type QueryParams = Record<
  string,
  string | number | boolean | readonly string[] | readonly number[] | undefined
>;

export class Http {
  readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly retry: RetryOptions;
  private readonly timeout: number;

  constructor(config: HttpConfig) {
    if (!config.apiKey) throw new VeloError("apiKey is required");
    this.baseUrl = config.baseUrl ?? BASE_URL;
    this.authHeader = `Basic ${btoa(`api:${config.apiKey}`)}`;
    this.fetchFn = config.fetch ?? globalThis.fetch;
    this.retry = { ...DEFAULT_RETRY, ...config.retry };
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
  }

  url(path: string, params: QueryParams = {}): string {
    const query = queryString.stringify(params, { arrayFormat: "comma", sort: false });
    return `${this.baseUrl}${path}${query ? `?${query}` : ""}`;
  }

  /**
   * GET a path and return the response body, retrying connection errors, timeouts,
   * and retryable statuses (DEFAULT_RETRYABLE_STATUSES) with capped exponential backoff.
   */
  async text(
    path: string,
    params: QueryParams = {},
    options: RequestOptions = {},
  ): Promise<string> {
    const url = this.url(path, params);
    const retry = { ...this.retry, ...options.retry };
    const timeout = options.timeout ?? this.timeout;

    for (let attempt = 0; ; attempt++) {
      let failure: VeloError;
      let retryAfter: number | undefined;

      try {
        const signals = [AbortSignal.timeout(timeout)];
        if (options.signal) signals.push(options.signal);
        const response = await this.fetchFn(url, {
          headers: { authorization: this.authHeader, "user-agent": USER_AGENT },
          signal: AbortSignal.any(signals),
        });
        const body = await response.text();

        if (response.ok) {
          return body;
        } else {
          retryAfter = retryAfterMs(response);
          failure = toError(
            response.status,
            body.trim(),
            url,
            Object.fromEntries(response.headers),
            retryAfter,
          );
        }
      } catch (thrown) {
        failure = toConnectionError(thrown, url, timeout, options.signal);
      }

      if (!isRetryable(failure) || attempt >= retry.retries) throw failure;
      await sleep(backoffMs(attempt, retry, retryAfter), options.signal);
    }
  }
}
