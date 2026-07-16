import { VeloError } from "../transport/error.js";

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
