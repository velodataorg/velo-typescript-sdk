import { describe, expect, it } from "vitest";

import { BASE_URL } from "../constants/endpoints.ts";
import { VeloConnectionError, VeloError } from "../errors.ts";
import { Velo } from "../index.ts";
import { parseBaseUrl } from "./base-url.ts";
import { Http } from "./http.ts";

describe("parseBaseUrl", () => {
  it("falls back to the public API when none is given", () => {
    expect(parseBaseUrl()).toBe(BASE_URL);
    expect(parseBaseUrl(undefined)).toBe(BASE_URL);
  });

  it.each([
    ["https://api.example.test", "https://api.example.test"],
    ["http://localhost:3000", "http://localhost:3000"],
    ["https://api.example.test///", "https://api.example.test"],
    ["https://api.example.test/prefix/", "https://api.example.test/prefix"],
  ])("takes %s, for a path to follow %s", (given, kept) => {
    expect(parseBaseUrl(given)).toBe(kept);
  });

  it.each(["not a url", "", "api.example.test", "/api", 123, null, {}])(
    "refuses %j, which is not a URL",
    (given) => {
      expect(() => parseBaseUrl(given as never)).toThrow(VeloError);
      expect(() => parseBaseUrl(given as never)).toThrow(/^invalid baseUrl /);
    },
  );

  it.each([
    ["ftp://example.test", "ftp:"],
    ["wss://example.test", "wss:"],
    ["localhost:3000", "localhost:"],
  ])("refuses %s, whose protocol is not HTTP(S)", (given, protocol) => {
    expect(() => parseBaseUrl(given)).toThrow(`invalid baseUrl protocol ${protocol}`);
  });
});

describe("a base URL that is not usable", () => {
  it.each(["not a url", "ftp://example.test"])(
    "fails where the client is made, before anything is sent: %s",
    (baseUrl) => {
      const client = () => new Velo({ apiKey: "key", baseUrl });
      const http = () => new Http({ apiKey: "key", baseUrl });

      expect(client).toThrow(/^invalid baseUrl /);
      expect(http).toThrow(/^invalid baseUrl /);
      /* A configuration error, which nothing retries, and no failed connection. */
      expect(client).toThrow(VeloError);
      expect(client).not.toThrow(VeloConnectionError);
    },
  );
});
