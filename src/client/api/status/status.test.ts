import { describe, expect, it } from "vitest";

import { VeloError } from "../../../errors.js";
import { Velo } from "../../client.js";

function client(body: string, urls: string[] = []) {
  const fetch: typeof globalThis.fetch = async (input) => {
    urls.push(String(input));
    return new Response(body);
  };

  return {
    velo: new Velo({ apiKey: "test_key", fetch }),
    urls,
  };
}

describe("Velo.status", () => {
  it("exposes one stable status endpoint", () => {
    const { velo } = client("ok");
    expect(velo.status).toBe(velo.status);
  });

  it("checks the status endpoint and normalizes its response", async () => {
    const { velo, urls } = client("ok\n");

    await expect(velo.status.get()).resolves.toBe("ok");
    expect(new URL(urls[0] as string).pathname).toBe("/api/v1/status");
  });

  it("rejects unexpected successful responses", async () => {
    await expect(client("degraded").velo.status.get()).rejects.toBeInstanceOf(VeloError);
    await expect(client("").velo.status.get()).rejects.toThrow(
      /Unexpected \/api\/v1\/status response/,
    );
  });
});
