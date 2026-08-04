import queryString from "query-string";

import { version } from "../../package.json";
import { BASE_URL } from "../constants/endpoints.ts";
import { VeloError, VeloRequestError } from "../errors.ts";
import { assert } from "../util/assert.ts";
import { toConnectionError, toError } from "./error-mapping.ts";
import { DEFAULT_RATE_LIMIT, RateLimiter } from "./rate-limit.ts";
import type { RateLimitOptions } from "./rate-limit.ts";
import {
  backoffMs,
  DEFAULT_RETRY,
  isRetryable,
  MAX_TIMER_MS,
  retryAfterMs,
  sleep,
  validateRetryOptions,
} from "./retry.ts";
import type { RetryOptions } from "./retry.ts";

const USER_AGENT = `velo-sdk/${version}`;

/**
 * @param timeout - The timeout to check.
 * @throws If `timeout` is not a positive integer of at most MAX_TIMER_MS
 * milliseconds — the bounds AbortSignal.timeout supports.
 */
function validateTimeout(timeout: number): void {
  assert(
    Number.isInteger(timeout) && timeout > 0 && timeout <= MAX_TIMER_MS,
    () =>
      `timeout must be a positive integer of at most ${MAX_TIMER_MS} milliseconds (got ${timeout})`,
  );
}

/* Per-attempt timeout in milliseconds; a timed-out attempt is aborted and
 * retried, consuming retry budget like any other retryable failure.
 */
export const DEFAULT_TIMEOUT = 60_000;

export interface HttpConfig {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  /**
   * Client-side request pacing, defaulting to {@link DEFAULT_RATE_LIMIT}.
   *
   * The API budget is per account, not per client, so divide `requests`
   * between the clients sharing one key. Pass `false` to send without pacing,
   * for callers that limit requests themselves.
   */
  rateLimit?: Partial<RateLimitOptions> | false;
  retry?: Partial<RetryOptions>;
  timeout?: number;
}

export interface HttpRequestOptions {
  signal?: AbortSignal;
  timeout?: number;
  retry?: Partial<RetryOptions>;
}

/* Values are serialized into the query string; arrays are comma-joined; undefined is skipped. */
export type HttpParams = Record<
  string,
  string | number | boolean | readonly string[] | readonly number[] | undefined
>;

export class Http {
  readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly rateLimiter: RateLimiter | undefined;
  private readonly retry: RetryOptions;
  private readonly secrets: readonly string[];
  private readonly timeout: number;

  /**
   * @param config - The API key plus optional base URL, fetch, rate-limit,
   * retry, and timeout overrides.
   * @throws If the API key is missing, or the rate-limit, retry, or timeout
   * options are invalid.
   */
  constructor(config: HttpConfig) {
    assert(config.apiKey, "apiKey is required");
    this.baseUrl = (config.baseUrl ?? BASE_URL).replace(/\/+$/, "");
    const authToken = btoa(`api:${config.apiKey}`);
    this.authHeader = `Basic ${authToken}`;
    this.fetchFn = config.fetch ?? globalThis.fetch;
    this.rateLimiter =
      config.rateLimit === false
        ? undefined
        : new RateLimiter({ ...DEFAULT_RATE_LIMIT, ...config.rateLimit });
    this.retry = { ...DEFAULT_RETRY, ...config.retry };
    this.secrets = [this.authHeader, authToken, config.apiKey].sort((a, b) => b.length - a.length);
    validateRetryOptions(this.retry);
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
    validateTimeout(this.timeout);
  }

  /**
   * Builds the absolute URL for a path.
   *
   * @param path - The endpoint path, starting with `/`.
   * @param params - Query params, serialized per HttpParams.
   * @returns The absolute URL with the query string appended.
   */
  url(path: string, params?: HttpParams): string {
    const query = queryString.stringify(params ?? {}, { arrayFormat: "comma", sort: false });
    return `${this.baseUrl}${path}${query ? `?${query}` : ""}`;
  }

  /**
   * GETs a path and returns the response body.
   *
   * @remarks
   * Retries connection errors, timeouts, and retryable statuses
   * (DEFAULT_RETRYABLE_STATUSES) with capped exponential backoff.
   *
   * @param path - The endpoint path, starting with `/`.
   * @param params - Query params for the request.
   * @param options - Per-request signal, timeout, and retry overrides.
   * @returns The response body.
   * @throws A VeloError subclass once the failure is not retryable or the
   * retry budget is exhausted.
   */
  async text(path: string, params?: HttpParams, options?: HttpRequestOptions): Promise<string> {
    const response = await this.#send(this.url(path, params), options);
    return response.text();
  }

  /**
   * GETs a path and yields its response body one line at a time.
   *
   * @remarks
   * The returned promise settles once the response headers arrive, so callers
   * can start a request without consuming it; the body is then read as it
   * streams in. Retries apply to establishing the response — once lines have
   * been yielded a mid-body failure surfaces to the caller instead.
   *
   * @param path - The endpoint path, starting with `/`.
   * @param params - Query params for the request.
   * @param options - Per-request signal, timeout, and retry overrides.
   * @returns Lines of the body, without their trailing newline.
   */
  async openLines(
    path: string,
    params?: HttpParams,
    options?: HttpRequestOptions,
  ): Promise<AsyncIterable<string>> {
    const response = await this.#send(this.url(path, params), options);
    return toLines(response.body);
  }

  /**
   * Sends one request, retrying until it succeeds or the budget is spent.
   *
   * The body is read here only to build an error: a successful response is
   * returned unread so the caller decides whether to buffer or stream it.
   */
  async #send(url: string, options?: HttpRequestOptions): Promise<Response> {
    // Validate the merged values: an override can corrupt a valid config,
    // e.g. an explicit `retries: undefined` would spread over the default.
    const retry = { ...this.retry, ...options?.retry };
    validateRetryOptions(retry);
    const timeout = options?.timeout ?? this.timeout;
    validateTimeout(timeout);

    for (let attempt = 0; ; attempt++) {
      let failure: VeloError;
      let retryAfter: number | undefined;

      try {
        // Paced per attempt: a retry is another request against the budget.
        await this.rateLimiter?.acquire(options?.signal);

        const signals = [AbortSignal.timeout(timeout)];
        if (options?.signal) signals.push(options.signal);
        const response = await this.fetchFn(url, {
          headers: { authorization: this.authHeader, "user-agent": USER_AGENT },
          signal: AbortSignal.any(signals),
        });

        if (response.ok) return response;

        const body = await response.text();
        if (response.status === 429) this.rateLimiter?.penalize();
        retryAfter = retryAfterMs(response);
        failure = toError(
          response.status,
          body.trim(),
          url,
          Object.fromEntries(response.headers),
          retryAfter,
        );
      } catch (thrown) {
        failure = toConnectionError(thrown, url, timeout, options?.signal, (value) =>
          this.#redact(value),
        );
      }

      if (!isRetryable(failure) || attempt >= retry.retries) throw failure;
      await sleep(backoffMs(attempt, retry, retryAfter), options?.signal);
    }
  }

  /**
   * GETs a path and parses its response body as JSON.
   *
   * @remarks
   * HTTP failures retain the retry and typed-error behavior of
   * {@link Http#text | text()}. The parsed value remains `unknown`: endpoint
   * code must validate its own response contract before exposing a type.
   *
   * @param path - The endpoint path, starting with `/`.
   * @param params - Query params for the request.
   * @param options - Per-request signal, timeout, and retry overrides.
   * @returns The parsed JSON value.
   * @throws A VeloError if a successful response is not valid JSON.
   */
  async json(path: string, params?: HttpParams, options?: HttpRequestOptions): Promise<unknown> {
    // Snapshot this before awaiting so a caller mutating its params cannot
    // make an invalid-JSON error point at a URL different from the one sent.
    const url = this.url(path, params);
    const body = await this.text(path, params, options);
    try {
      return JSON.parse(body) as unknown;
    } catch (cause) {
      throw new VeloRequestError(`Velo API returned invalid JSON: ${url}`, { url, cause });
    }
  }

  #redact(value: string): string {
    let safe = value;
    for (const secret of this.secrets) safe = safe.split(secret).join("[REDACTED]");
    return safe;
  }
}

/**
 * Splits a response body into lines as its chunks arrive.
 *
 * A trailing fragment without a newline is yielded when the body ends, so a
 * response whose last line is unterminated is not dropped.
 */
async function* toLines(body: ReadableStream<Uint8Array> | null): AsyncGenerator<string> {
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });

      for (let newline = buffered.indexOf("\n"); newline >= 0; newline = buffered.indexOf("\n")) {
        yield buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
      }
    }
    buffered += decoder.decode();
    if (buffered.length > 0) yield buffered;
  } finally {
    await reader.cancel().catch(() => {});
  }
}
