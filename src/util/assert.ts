import { VeloError } from "../errors.js";

/**
 * Asserts that `condition` is truthy.
 *
 * @remarks
 * Narrows types: after `assert(value !== undefined, ...)`, `value` excludes
 * undefined.
 *
 * @param condition - The condition to check.
 * @param message - The failure message; may be a function for messages that
 * are expensive to build.
 * @param ErrorClass - The error to throw on failure.
 * @throws An `ErrorClass` (default VeloError) with `message` when
 * `condition` is falsy.
 */
export function assert(
  condition: unknown,
  message: string | (() => string),
  ErrorClass: new (message: string) => VeloError = VeloError,
): asserts condition {
  if (condition) return;
  throw new ErrorClass(typeof message === "function" ? message() : message);
}

/**
 * Asserts a value is really an array of non-empty strings — plain-JS callers
 * can pass anything, and a bare string would otherwise slip past length
 * checks and be spread into characters.
 *
 * @param value - The value to check.
 * @param field - The field name, for the failure message.
 * @throws A VeloError if `value` is not an array of non-empty strings.
 */
export function assertStringArray(
  value: unknown,
  field: string,
): asserts value is readonly string[] {
  assert(Array.isArray(value), () => `${field} must be an array (got ${typeof value})`);
  // for..of observes holes as undefined; array callbacks like every() skip
  // them, which would let a sparse array through unchecked.
  for (const item of value) {
    assert(
      typeof item === "string" && item !== "",
      () => `${field} must contain only non-empty strings`,
    );
  }
}
