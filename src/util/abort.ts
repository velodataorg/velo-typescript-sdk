/**
 * Extracts a signal's abort reason.
 *
 * @param signal - An aborted signal.
 * @returns The signal's reason, or a default AbortError for runtimes that
 * predate `AbortSignal.reason`.
 */
export function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

/**
 * Checks for the AbortSignal surface the SDK relies on.
 *
 * @remarks
 * Structural rather than `instanceof`, so a signal from another realm — a
 * worker, an iframe, a polyfill — is accepted.
 *
 * @param value - A candidate signal.
 * @returns Whether `value` can be inspected and listened to as a signal.
 */
export function isAbortSignal(value: unknown): value is AbortSignal {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<AbortSignal>;
  return (
    typeof candidate.aborted === "boolean" &&
    typeof candidate.addEventListener === "function" &&
    typeof candidate.removeEventListener === "function"
  );
}
