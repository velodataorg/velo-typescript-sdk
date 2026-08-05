import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { describe, expect, test as base } from "vitest";

import { defaultWebSocketFactory } from "./websocket.ts";
import type { WebSocketTarget } from "./websocket.ts";

/**
 * Handshake behaviour against a real server and a real WebSocket client.
 *
 * A refused upgrade is reported by the client's own event, whose contract
 * belongs to the runtime rather than to this SDK. Faking that event would
 * assert only that the adapter agrees with the fake, so these drive an actual
 * server instead — local, on an ephemeral port, with no credentials.
 */

interface Refusal extends Error {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
}

type Refusing = (status: number, body: string) => Promise<WebSocketTarget>;

const it = base.extend<{ refusing: Refusing }>({
  /* Vitest reads this parameter's destructuring to resolve fixture
   * dependencies, so the empty pattern is required rather than incidental.
   */
  // eslint-disable-next-line no-empty-pattern
  refusing: async ({}, use) => {
    const servers: Server[] = [];

    await use(async (status, body) => {
      const server = createServer((_request, response) => {
        response.writeHead(status, { "content-type": "text/plain" });
        response.end(body);
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      servers.push(server);

      const { port } = server.address() as AddressInfo;
      const url = `ws://127.0.0.1:${port}`;
      return { url, authenticatedUrl: url, headers: {} };
    });

    await Promise.all(
      servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
    );
  },
});

/** Dials `target` and resolves with the failure the adapter surfaces. */
async function refusalFrom(target: WebSocketTarget): Promise<Refusal> {
  const socket = await defaultWebSocketFactory(target);
  try {
    return await new Promise<Refusal>((resolve, reject) => {
      socket.addEventListener("error", (event) => {
        if (event.error instanceof Error) resolve(event.error);
        else reject(new Error(`expected an Error, got ${typeof event.error}`));
      });
      setTimeout(() => reject(new Error("the socket reported no error")), 10_000);
    });
  } finally {
    socket.close();
  }
}

describe("refused handshake", () => {
  it.for([
    { status: 403, body: "api key not authorized" },
    { status: 503, body: "upstream down" },
  ])("reports the $status the server answered with", async ({ status, body }, { refusing }) => {
    const refusal = await refusalFrom(await refusing(status, body));

    expect(refusal.status).toBe(status);
    expect(refusal.body).toBe(body);
    expect(refusal.headers?.["content-type"]).toBe("text/plain");
  });

  it("survives a refusal that arrives with no listener attached", async ({
    refusing,
    onTestFinished,
  }) => {
    const target = await refusing(403, "gone");

    let uncaught: unknown;
    const record = (error: unknown): void => {
      uncaught = error;
    };
    process.on("uncaughtException", record);
    onTestFinished(() => {
      process.off("uncaughtException", record);
    });

    /* The window between a caller tearing its listeners down and the server
     * answering. Emitting into it would throw and take the process with it.
     */
    await defaultWebSocketFactory(target);
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(uncaught).toBeUndefined();
  });
});
