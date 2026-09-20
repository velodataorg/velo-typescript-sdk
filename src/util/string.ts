/**
 * Whether a value is a string with something in it.
 *
 * @param value - The candidate.
 * @returns Whether `value` is a non-empty string.
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
