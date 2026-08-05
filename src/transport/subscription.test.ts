import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

import { describe, expect, test as base } from "vitest";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";

import type { NewsStory } from "../client/api/news/validation.ts";
import { VeloAuthError } from "../errors.ts";
import { Velo } from "../index.ts";

/**
 * A subscription carried end to end over a real socket.
 *
 * Everything between the client and the wire — the upgrade, its credentials,
 * the subscribe frame, a pushed message — is the runtime's behaviour, not
 * this SDK's. A fake socket can only replay what it was told to; this accepts
 * a genuine connection on an ephemeral port, with no credentials and no
 * network.
 */

const STORY = {
  id: 1646,
  time: 1765554594943,
  effectiveTime: 1765554594943,
  effectivePrice: 29.058,
  headline: "Hyperliquid To Introduce Portfolio Margin",
  source: "Team",
  priority: 2,
  coins: ["HYPE"],
  summary: "Portfolio margin is coming.",
  link: "https://t.me/hyperliquid_announcements",
};

interface Feed {
  readonly baseUrl: string;
  readonly upgrades: IncomingMessage[];
  readonly sent: string[];
  push(frame: unknown): void;
}

/** A server that answers every upgrade instead of accepting it. */
interface Refusing {
  readonly baseUrl: string;
  /** How many upgrade attempts it has answered. */
  attempts(): number;
}

const it = base.extend<{ feed: Feed; refusing: Refusing }>({
  /* Vitest reads this parameter's destructuring to resolve fixture
   * dependencies, so the empty pattern is required rather than incidental.
   */
  // eslint-disable-next-line no-empty-pattern
  feed: async ({}, use) => {
    const server = createServer();
    const sockets = new WebSocketServer({ server });
    const upgrades: IncomingMessage[] = [];
    const sent: string[] = [];
    const clients = new Set<WebSocket>();

    sockets.on("connection", (socket, request) => {
      upgrades.push(request);
      clients.add(socket);
      socket.on("message", (data: Buffer) => sent.push(data.toString("utf8")));
      socket.on("close", () => clients.delete(socket));
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    await use({
      baseUrl: `http://127.0.0.1:${port}`,
      upgrades,
      sent,
      push: (frame) => {
        for (const socket of clients) socket.send(JSON.stringify(frame));
      },
    });

    for (const socket of clients) socket.terminate();
    sockets.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  },

  // eslint-disable-next-line no-empty-pattern
  refusing: async ({}, use) => {
    let attempts = 0;
    const server = createServer((_request, response) => {
      attempts++;
      response.writeHead(403, { "content-type": "text/plain" });
      response.end("api key not authorized");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    await use({ baseUrl: `http://127.0.0.1:${port}`, attempts: () => attempts });

    await new Promise<void>((resolve) => server.close(() => resolve()));
  },
});

/** Waits for `check` to hold, so a test never guesses how long a hop takes. */
async function until(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("a live subscription", () => {
  it("authenticates, subscribes, and delivers what the server pushes", async ({ feed }) => {
    const velo = new Velo({ apiKey: "test/key", baseUrl: feed.baseUrl });
    const stories: NewsStory[] = [];

    const watcher = await velo.watch(velo.news.feed(), {
      on: { story: (story) => stories.push(story) },
    });

    /* The credentials reached the server, rather than merely being handed to
     * the socket constructor.
     */
    expect(feed.upgrades).toHaveLength(1);
    expect(feed.upgrades[0]?.headers.authorization).toBe(`Basic ${btoa("api:test/key")}`);

    await until(() => feed.sent.length > 0, "the subscribe frame");
    expect(feed.sent).toEqual(["subscribe news_priority"]);

    feed.push(STORY);
    await until(() => stories.length > 0, "the pushed story");
    expect(stories[0]?.headline).toBe(STORY.headline);

    watcher.close();
  });

  it("reconnects when the server drops the connection", async ({ feed }) => {
    const velo = new Velo({ apiKey: "test/key", baseUrl: feed.baseUrl });
    const watcher = await velo.watch(velo.news.feed(), {
      reconnect: { baseDelayMs: 10, maxDelayMs: 50 },
    });

    await until(() => feed.sent.length === 1, "the first subscribe");
    feed.push({ dropping: true });
    for (const upgrade of feed.upgrades) upgrade.socket.destroy();

    await until(() => feed.sent.length === 2, "the resubscribe");
    expect(feed.upgrades.length).toBeGreaterThan(1);
    expect(watcher.state).toBe("open");

    watcher.close();
  });

  it("rejects a refused upgrade with the mapped error, dialling once", async ({ refusing }) => {
    const velo = new Velo({ apiKey: "test/key", baseUrl: refusing.baseUrl });

    /* The whole chain over a real socket: the server refuses, the adapter
     * reads the status it sent, the mapping types it, and the policy declines
     * to dial a rejection twice.
     */
    await expect(velo.watch(velo.news.feed())).rejects.toBeInstanceOf(VeloAuthError);
    expect(refusing.attempts()).toBe(1);
  });
});
