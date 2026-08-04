/**
 * Error hierarchy:
 *
 * ```text
 * VeloError
 * └── VeloRequestError                 // url
 *     ├── VeloHttpError                // status, body, headers
 *     │   ├── VeloBadRequestError
 *     │   ├── VeloAuthError
 *     │   ├── VeloRateLimitError
 *     │   └── VeloServerError
 *     └── VeloConnectionError
 *         └── VeloTimeoutError
 * ```
 */

export class VeloError extends Error {
  /**
   * @param message - The error message.
   * @param options - Standard error options; `cause` is forwarded to `Error`.
   */
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
  }
}

export interface VeloRequestErrorDetails extends ErrorOptions {
  url: string;
}

/* A failure associated with one API request. */
export class VeloRequestError extends VeloError {
  readonly url: string;

  constructor(message: string, details: VeloRequestErrorDetails) {
    super(message, details);
    this.url = details.url;
  }
}

export interface VeloHttpErrorDetails extends VeloRequestErrorDetails {
  status: number;
  body: string;
  headers: Record<string, string>;
}

/* A non-successful HTTP response from the API. */
export class VeloHttpError extends VeloRequestError {
  readonly status: number;
  readonly body: string;
  readonly headers: Record<string, string>;

  constructor(message: string, details: VeloHttpErrorDetails) {
    super(message, details);
    this.status = details.status;
    this.body = details.body;
    this.headers = details.headers;
  }
}

/* 400 — the API rejected the request parameters. */
export class VeloBadRequestError extends VeloHttpError {}

/* 401/403 — missing, invalid, or unauthorized API key. */
export class VeloAuthError extends VeloHttpError {}

/* 429 — rate limit exceeded (120 requests per 30 seconds). Retried automatically. */
export class VeloRateLimitError extends VeloHttpError {
  readonly #retryAfterMs: number | undefined;

  /**
   * @param message - The error message.
   * @param details - The response details, plus the parsed Retry-After.
   */
  constructor(
    message: string,
    details: VeloHttpErrorDetails & { retryAfterMs?: number | undefined },
  ) {
    super(message, details);
    this.#retryAfterMs = details.retryAfterMs;
  }

  /* Parsed Retry-After header, if the response carried one. */
  get retryAfterMs(): number | undefined {
    return this.#retryAfterMs;
  }
}

/* 5xx — the API is temporarily unavailable. Transient statuses (see DEFAULT_RETRYABLE_STATUSES) are retried automatically. */
export class VeloServerError extends VeloHttpError {}

/* The request never completed — DNS, TLS, or socket failure. Retried automatically. */
export class VeloConnectionError extends VeloRequestError {}

/* A single attempt exceeded `timeout`. Retried automatically. */
export class VeloTimeoutError extends VeloConnectionError {
  readonly timeout: number;

  /**
   * @param message - The error message.
   * @param details - The failure details, plus the exceeded timeout in
   * milliseconds.
   */
  constructor(message: string, details: VeloRequestErrorDetails & { timeout: number }) {
    super(message, details);
    this.timeout = details.timeout;
  }
}
