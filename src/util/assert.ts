import { VeloError } from "../transport/error.js";

/**
 * Asserts that `condition` is truthy, throwing `ErrorClass` (default
 * VeloError) with `message` otherwise. Narrows types: after
 * `assert(value !== undefined, ...)`, `value` excludes undefined.
 *
 * `message` may be a function for messages that are expensive to build.
 */
export function assert(
  condition: unknown,
  message: string | (() => string),
  ErrorClass: new (message: string) => VeloError = VeloError,
): asserts condition {
  if (condition) return;
  throw new ErrorClass(typeof message === "function" ? message() : message);
}
