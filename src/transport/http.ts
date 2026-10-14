import queryString from "query-string";

import { version } from "../../package.json";
import { VeloError, VeloRequestError } from "../errors.ts";
import { assert } from "../util/assert.ts";
import { parseBaseUrl } from "./base-url.ts";
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
 * milliseconds — the bounds a timer supports.
 */
function validateTimeout(timeout: number): void {
  assert(
    Number.isInteger(timeout) && timeout > 0 && timeout <= MAX_TIMER_MS,
    () =>
      `timeout must be a positive integer of at most ${MAX_TIMER_MS} milliseconds (got ${timeout})`,
  );
}

/* How long the SDK waits on the server at any one time, in milliseconds; see HttpConfig.timeout. */
export const DEFAULT_TIMEOUT = 60_000;

/* Waits on the server for one step of an attempt, failing the attempt if the wait outlasts the timeout. */
type Wait = <T>(step: Promise<T>) => Promise<T>;

export interface HttpConfig {
  apiKey: string;
  /*
   * The HTTP(S) address of the Velo API, which sockets upgrade from too.
   * Defaults to the public API, and is checked when the client is made.
   */
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
  /**
   * How long, in milliseconds, the SDK waits on the server at any one time,
   * defaulting to {@link DEFAULT_TIMEOUT}.
   *
   * The clock runs while the SDK waits for a response to start, and then for
   * each next piece of its body. Time the caller takes between reads does not
   * count, so a slow consumer or a response fetched ahead never times out. A
   * wait that runs out fails the attempt as a VeloTimeoutError. For a limit
   * on a whole request, pass a `signal`, such as `AbortSignal.timeout()`.
   */
  timeout?: number;
}

export interface HttpRequestOptions {
  signal?: AbortSignal;
  /* Replaces {@link HttpConfig.timeout} for this request. */
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
   * @throws If the API key is missing, the base URL is not an HTTP(S) URL, or
   * the rate-limit, retry, or timeout options are invalid.
   */
  constructor(config: HttpConfig) {
    assert(config.apiKey, "apiKey is required");
    this.baseUrl = parseBaseUrl(config.baseUrl);
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
   * (DEFAULT_RETRYABLE_STATUSES) with capped exponential backoff. A failure
   * while the body is read is retried the same way, since nothing has been
   * handed out yet.
   *
   * @param path - The endpoint path, starting with `/`.
   * @param params - Query params for the request.
   * @param options - Per-request signal, timeout, and retry overrides.
   * @returns The response body.
   * @throws A VeloError subclass once the failure is not retryable or the
   * retry budget is exhausted.
   */
  async text(path: string, params?: HttpParams, options?: HttpRequestOptions): Promise<string> {
    return this.#send(this.url(path, params), options, (response, wait) =>
      readText(response.body, wait),
    );
  }

  /**
   * GETs a path and yields its response body one line at a time.
   *
   * @remarks
   * The returned promise settles once the response headers arrive, so callers
   * can start a request without consuming it; the body is then read as it
   * streams in. Retries apply to establishing the response. A failure while
   * the body is read surfaces to the caller, typed as a failed request is,
   * and is not retried: lines may already have been handed out.
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
    return this.#send(this.url(path, params), options, (response, wait) =>
      toLines(readChunks(response.body, wait)),
    );
  }

  /**
   * Sends one request, retrying until it succeeds or the budget is spent.
   *
   * @remarks
   * A successful response goes to `read`, inside the attempt: what `read`
   * waits on before returning is retried as part of it, and what it reads
   * later is still timed by `wait` but surfaces to its own reader.
   *
   * @param url - The URL to request.
   * @param options - Per-request signal, timeout, and retry overrides.
   * @param read - Takes a successful response, with the attempt's `wait` for
   * timing each read of its body.
   * @returns What `read` returned.
   * @throws A VeloError subclass once the failure is not retryable or the
   * retry budget is exhausted, or the caller's abort reason.
   */
  async #send<R>(
    url: string,
    options: HttpRequestOptions | undefined,
    read: (response: Response, wait: Wait) => R | Promise<R>,
  ): Promise<R> {
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

        const { signal, wait } = this.#deadline(url, timeout, options?.signal);
        const response = await wait(
          this.fetchFn(url, {
            headers: { authorization: this.authHeader, "user-agent": USER_AGENT },
            signal,
          }),
        );

        if (response.ok) return await read(response, wait);

        const body = await wait(response.text());
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
        /* What a wait threw is typed already. */
        failure =
          thrown instanceof VeloError
            ? thrown
            : toConnectionError(thrown, url, timeout, options?.signal, (value) =>
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

  /**
   * Builds one attempt's timeout: the signal its request is sent with, and
   * the `wait` that times each step of it.
   *
   * @remarks
   * The clock runs only during a wait on the server: for the response to
   * start, and for each next piece of its body. A wait that runs out aborts
   * the attempt's signal, which fails the request or the read in progress.
   * Whatever a wait fails with is typed as a failed request is, so a read
   * after the attempt returned reports like one inside it.
   *
   * @param url - The request URL, for errors.
   * @param timeout - The longest one wait may take, in milliseconds.
   * @param callerSignal - The caller's signal, if any; its abort reason is
   * passed through untouched.
   * @returns The attempt's signal and its `wait`.
   */
  #deadline(
    url: string,
    timeout: number,
    callerSignal: AbortSignal | undefined,
  ): { readonly signal: AbortSignal; readonly wait: Wait } {
    const deadline = new AbortController();
    const signal = callerSignal
      ? AbortSignal.any([deadline.signal, callerSignal])
      : deadline.signal;
    const wait: Wait = async (step) => {
      const timer = setTimeout(() => {
        deadline.abort(new DOMException(`No answer within ${timeout}ms`, "TimeoutError"));
      }, timeout);
      try {
        return await step;
      } catch (thrown) {
        throw toConnectionError(thrown, url, timeout, callerSignal, (value) => this.#redact(value));
      } finally {
        clearTimeout(timer);
      }
    };
    return { signal, wait };
  }

  #redact(value: string): string {
    let safe = value;
    for (const secret of this.secrets) safe = safe.split(secret).join("[REDACTED]");
    return safe;
  }
}

/**
 * Reads a response body piece by piece, each read timed as one wait on the
 * server.
 *
 * @param body - The response body; null reads as empty.
 * @param wait - The attempt's wait, timing each read.
 * @returns The body's chunks as they arrive. Stopping early cancels the body.
 */
async function* readChunks(
  body: ReadableStream<Uint8Array> | null,
  wait: Wait,
): AsyncGenerator<Uint8Array> {
  if (!body) return;
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await wait(reader.read());
      if (done) return;
      yield value;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/**
 * Reads a whole response body as text.
 *
 * @param body - The response body; null reads as empty.
 * @param wait - The attempt's wait, timing each read.
 * @returns The body's text.
 */
async function readText(body: ReadableStream<Uint8Array> | null, wait: Wait): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of readChunks(body, wait)) text += decoder.decode(chunk, { stream: true });
  return text + decoder.decode();
}

/**
 * Splits a response body into lines as its chunks arrive.
 *
 * A trailing fragment without a newline is yielded when the body ends, so a
 * response whose last line is unterminated is not dropped.
 *
 * @param chunks - The body's chunks, as they arrive.
 * @returns The body's lines, without their trailing newlines.
 */
async function* toLines(chunks: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffered = "";

  for await (const chunk of chunks) {
    buffered += decoder.decode(chunk, { stream: true });

    for (let newline = buffered.indexOf("\n"); newline >= 0; newline = buffered.indexOf("\n")) {
      yield buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
    }
  }
  buffered += decoder.decode();
  if (buffered.length > 0) yield buffered;
}
