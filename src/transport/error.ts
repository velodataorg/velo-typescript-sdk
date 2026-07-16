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

/**
 * Maps an HTTP error response to the matching typed error.
 *
 * @param status - The response status code.
 * @param body - The response body, included in the message.
 * @param url - The request URL.
 * @param headers - The response headers.
 * @param retryAfterMs - Parsed Retry-After header, for 429 responses.
 * @returns The VeloError subclass for the status; plain VeloError for
 * statuses with no mapping.
 */
export function toError(
  status: number,
  body: string,
  url: string,
  headers: Record<string, string>,
  retryAfterMs?: number,
): VeloError {
  const message = `Velo API ${status}: ${body || "(empty body)"}`;
  const details = { status, body, url, headers };
  if (status === 400) return new VeloBadRequestError(message, details);
  if (status === 401 || status === 403) return new VeloAuthError(message, details);
  if (status === 429) return new VeloRateLimitError(message, { ...details, retryAfterMs });
  if (status >= 500) return new VeloServerError(message, details);
  return new VeloError(message, details);
}

/**
 * Maps a thrown fetch/body-read failure to a typed, retryable error.
 *
 * @param thrown - The value fetch threw.
 * @param url - The request URL.
 * @param timeout - The per-attempt timeout in milliseconds.
 * @param signal - The caller's abort signal, if any.
 * @returns A VeloTimeoutError for timeouts, a VeloConnectionError otherwise.
 * @throws The original `thrown` when it was an abort — cancellation must
 * never be mistaken for an API failure.
 */
export function toConnectionError(
  thrown: unknown,
  url: string,
  timeout: number,
  signal?: AbortSignal,
): VeloConnectionError {
  if (signal?.aborted) throw thrown;
  if (thrown instanceof Error && thrown.name === "TimeoutError") {
    return new VeloTimeoutError(`Velo API request timed out after ${timeout}ms: ${url}`, {
      url,
      timeout,
      cause: thrown,
    });
  }
  if (thrown instanceof Error && thrown.name === "AbortError") throw thrown;
  const reason = thrown instanceof Error ? thrown.message : String(thrown);
  return new VeloConnectionError(`Velo API request failed: ${reason}`, { url, cause: thrown });
}
