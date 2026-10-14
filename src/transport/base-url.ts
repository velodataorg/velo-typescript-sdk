import { BASE_URL } from "../constants/endpoints.ts";
import { VeloError } from "../errors.ts";
import { assert } from "../util/assert.ts";

/**
 * Checks the address every request and socket is built on.
 *
 * @remarks
 * Checked when a transport is made, so a mistaken base URL fails where the
 * client is created. Left until a request is sent or a socket is dialled, it
 * reads as a connection that failed, and is retried as one.
 *
 * @param baseUrl - The caller's base URL; omitted means the default.
 * @returns The base URL without trailing slashes, for a path to follow.
 * @throws A VeloError when it is not a URL, or not an HTTP(S) one.
 */
export function parseBaseUrl(baseUrl: string = BASE_URL): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch (cause) {
    throw new VeloError(`invalid baseUrl ${baseUrl}`, { cause });
  }
  assert(
    url.protocol === "https:" || url.protocol === "http:",
    () => `invalid baseUrl protocol ${url.protocol}`,
  );
  return baseUrl.replace(/\/+$/, "");
}
