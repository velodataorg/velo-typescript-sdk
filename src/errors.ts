export interface VeloErrorDetails {
  status?: number | undefined;
  body?: string | undefined;
  url?: string | undefined;
  headers?: Record<string, string> | undefined;
  cause?: unknown;
}

export class VeloError extends Error {
  readonly status: number | undefined;
  readonly body: string | undefined;
  readonly url: string | undefined;
  readonly headers: Record<string, string> | undefined;

  /**
   * @param message - The error message.
   * @param details - The response/failure details; `cause` is forwarded to
   * `Error`.
   */
  constructor(message: string, details: VeloErrorDetails = {}) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = new.target.name;
    this.status = details.status;
    this.body = details.body;
    this.url = details.url;
    this.headers = details.headers;
  }
}

/* 400 — the API rejected the request parameters. */
export class VeloBadRequestError extends VeloError {}

/* 401/403 — missing, invalid, or unauthorized API key. */
export class VeloAuthError extends VeloError {}

/* 429 — rate limit exceeded (120 requests per 30 seconds). Retried automatically. */
export class VeloRateLimitError extends VeloError {
  /* Parsed Retry-After header, if the response carried one. */
  readonly retryAfterMs: number | undefined;

  /**
   * @param message - The error message.
   * @param details - The response details, plus the parsed Retry-After.
   */
  constructor(
    message: string,
    details: VeloErrorDetails & { retryAfterMs?: number | undefined } = {},
  ) {
    super(message, details);
    this.retryAfterMs = details.retryAfterMs;
  }
}

/* 5xx — the API is temporarily unavailable. Transient statuses (see DEFAULT_RETRYABLE_STATUSES) are retried automatically. */
export class VeloServerError extends VeloError {}

/* The request never completed — DNS, TLS, or socket failure. Retried automatically. */
export class VeloConnectionError extends VeloError {}

/* A single attempt exceeded `timeout`. Retried automatically. */
export class VeloTimeoutError extends VeloConnectionError {
  readonly timeout: number;

  /**
   * @param message - The error message.
   * @param details - The failure details, plus the exceeded timeout in
   * milliseconds.
   */
  constructor(message: string, details: VeloErrorDetails & { timeout: number }) {
    super(message, details);
    this.timeout = details.timeout;
  }
}
