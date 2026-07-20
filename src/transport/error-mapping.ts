import {
  VeloAuthError,
  VeloBadRequestError,
  VeloConnectionError,
  VeloHttpError,
  VeloRateLimitError,
  VeloServerError,
  VeloTimeoutError,
} from "../errors.js";

/**
 * Maps an HTTP error response to the matching typed error.
 *
 * @param status - The response status code.
 * @param body - The response body, included in the message.
 * @param url - The request URL.
 * @param headers - The response headers.
 * @param retryAfterMs - Parsed Retry-After header, for 429 responses.
 * @returns The VeloHttpError subclass for the status; plain VeloHttpError
 * for statuses with no specialized mapping.
 */
export function toError(
  status: number,
  body: string,
  url: string,
  headers: Record<string, string>,
  retryAfterMs?: number,
): VeloHttpError {
  const message = `Velo API ${status}: ${body || "(empty body)"}`;
  const details = { status, body, url, headers };
  if (status === 400) return new VeloBadRequestError(message, details);
  if (status === 401 || status === 403) return new VeloAuthError(message, details);
  if (status === 429) return new VeloRateLimitError(message, { ...details, retryAfterMs });
  if (status >= 500) return new VeloServerError(message, details);
  return new VeloHttpError(message, details);
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
