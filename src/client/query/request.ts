/**
 * Lowers a request-or-builder input to the request it describes.
 *
 * Anything exposing a callable `build` is treated as a builder; everything
 * else is already a request. Shared by every execution verb so `query`,
 * `stream`, and `watch` accept their inputs identically.
 */
export function toRequest<T>(input: T | { build(): T }): T {
  const candidate: unknown = input;
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return input as T;
  }

  const { build } = candidate as { readonly build?: unknown };
  if (typeof build !== "function") return input as T;
  return build.call(candidate) as T;
}
