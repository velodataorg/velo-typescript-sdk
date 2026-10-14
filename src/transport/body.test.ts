import { createServer } from "node:http";
import type { Server as NodeServer, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { Query } from "../client/query/query.ts";
import { VeloError, VeloTimeoutError } from "../errors.ts";
import { Velo } from "../index.ts";
import { Http } from "./http.ts";

/*
 * Reading a response body over a real socket, from a local server that sends
 * each body the way a test scripts it. The timings are the point: the
 * timeout is short, and a reader's pause, or a gap the server leaves while
 * nobody is reading, outlasts it.
 */
const TIMEOUT = 100;
const PAUSE = 300;
const GAP = 200;

interface Server {
  readonly baseUrl: string;
  readonly hits: () => number;
}

const servers: NodeServer[] = [];
const responses: ServerResponse[] = [];

/**
 * Starts a local server for one test.
 *
 * @param handler - Sends the response to the request with the given 1-based number.
 * @returns The server's address, and how many requests it has had.
 */
async function serve(handler: (response: ServerResponse, hit: number) => void): Promise<Server> {
  let hits = 0;
  const server = createServer((_request, response) => {
    hits++;
    responses.push(response);
    handler(response, hits);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, hits: () => hits };
}

afterEach(async () => {
  for (const response of responses.splice(0)) response.destroy();
  await Promise.all(
    servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
  );
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Builds a client of the local server with the short timeout.
 *
 * @param baseUrl - The local server's address.
 * @param retries - How many times a failed attempt is retried.
 * @returns The client.
 */
function http(baseUrl: string, retries = 0): Http {
  return new Http({
    apiKey: "key",
    baseUrl,
    timeout: TIMEOUT,
    rateLimit: false,
    retry: { retries, baseDelayMs: 1, maxDelayMs: 1 },
  });
}

/**
 * Reads lines, pausing after the first as a slow consumer would.
 *
 * @param lines - The lines to read.
 * @param pause - How long to pause after the first line, in milliseconds.
 * @returns Every line read.
 */
async function readSlowly(lines: AsyncIterable<string>, pause: number): Promise<string[]> {
  const seen: string[] = [];
  for await (const line of lines) {
    seen.push(line);
    if (seen.length === 1) await sleep(pause);
  }
  return seen;
}

describe("reading a response body", () => {
  it("times out a body that stops arriving, as a VeloTimeoutError", async () => {
    const { baseUrl } = await serve((response) => response.write("first\n"));
    const lines = await http(baseUrl).openLines("/x");

    const seen: string[] = [];
    const error = await (async () => {
      for await (const line of lines) seen.push(line);
    })().catch((cause: unknown) => cause);

    expect(seen).toEqual(["first"]);
    expect(error).toBeInstanceOf(VeloTimeoutError);
  });

  it("retries a buffered body that stops arriving, as a failed attempt", async () => {
    const server = await serve((response, hit) => {
      if (hit === 1) response.write("part of it");
      else response.end("the whole body");
    });

    await expect(http(server.baseUrl, 1).text("/x")).resolves.toBe("the whole body");
    expect(server.hits()).toBe(2);
  });

  it("does not count the time a reader takes between reads", async () => {
    /* The server's gap outlasts the timeout, but nobody is waiting on it then. */
    const { baseUrl } = await serve((response) => {
      response.write("a\n");
      setTimeout(() => response.end("b\nc\n"), GAP);
    });
    const lines = await http(baseUrl).openLines("/x");

    await expect(readSlowly(lines, PAUSE)).resolves.toEqual(["a", "b", "c"]);
  });

  it("does not time out a response fetched ahead while an earlier one is read", async () => {
    const { baseUrl } = await serve((response, hit) => {
      response.write(`${hit}a\n`);
      setTimeout(() => response.end(`${hit}b\n`), GAP);
    });
    const query = new Query(http(baseUrl), {
      requests: [
        { path: "/x", params: { n: 1 } },
        { path: "/x", params: { n: 2 } },
      ],
      decodeLines: (lines) => lines,
    });

    await expect(readSlowly(query.stream(), PAUSE)).resolves.toEqual(["1a", "1b", "2a", "2b"]);
  });

  it("hands the caller's own abort reason back while the body is read", async () => {
    const { baseUrl } = await serve((response) => response.write("first\n"));
    const controller = new AbortController();
    const stopped = new Error("caller stopped");
    const lines = await http(baseUrl).openLines("/x", {}, { signal: controller.signal });

    const error = await (async () => {
      for await (const _line of lines) controller.abort(stopped);
    })().catch((cause: unknown) => cause);

    expect(error).toBe(stopped);
  });
});

describe("a CSV response read through a query", () => {
  const CAPS = { kind: "marketCaps.history", params: { coins: ["BTC"] } } as const;
  const HEADER = "coin,time,circ,circ_dollars,fdv,fdv_dollars\n";

  /**
   * Builds a client of the local server with the short timeout.
   *
   * @param baseUrl - The local server's address.
   * @returns The client.
   */
  function velo(baseUrl: string): Velo {
    return new Velo({
      apiKey: "key",
      baseUrl,
      timeout: TIMEOUT,
      rateLimit: false,
      retry: { retries: 0, baseDelayMs: 1, maxDelayMs: 1 },
    });
  }

  it("reports a body that stops arriving as a timeout, not a malformed response", async () => {
    const { baseUrl } = await serve((response) => response.write(`${HEADER}BTC,0,1,2,3,4\n`));

    await expect(velo(baseUrl).query(CAPS)).rejects.toBeInstanceOf(VeloTimeoutError);
  });

  it("hands back the caller's abort reason, not a malformed response", async () => {
    const { baseUrl } = await serve((response) => response.write(`${HEADER}BTC,0,1,2,3,4\n`));
    const stopped = new Error("caller stopped");
    const controller = new AbortController();
    setTimeout(() => controller.abort(stopped), TIMEOUT / 2);

    await expect(velo(baseUrl).query(CAPS, { signal: controller.signal })).rejects.toBe(stopped);
  });

  it("still reports a body that does not fit as a malformed response", async () => {
    const { baseUrl } = await serve((response) => response.end("coin,time\nBTC,0\n"));

    const error = await velo(baseUrl)
      .query(CAPS)
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(VeloError);
    expect((error as VeloError).message).toBe("Unexpected /api/v1/caps response");
  });
});
