/**
 * Whether a value is an object to read fields from.
 *
 * @param value - The candidate.
 * @returns Whether `value` is a non-null object that is not an array.
 */
export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
