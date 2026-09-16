import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

import { describe, expect, test as base } from "vitest";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";

import type { NewsStory } from "../client/api/news/validation.ts";
import { VeloAuthError } from "../errors.ts";
import { Velo } from "../index.ts";
import type { RawChannelMessage } from "../index.ts";
import { defaultWebSocketFactory } from "./websocket.ts";

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
  it("authenticates raw channels, multiplexes data, and unsubscribes over a real socket", async ({
    feed,
  }) => {
    const names = [
      "realtime_binance-futures:BTCUSDT",
      "realtime_BTC#open_interest#Coins#Aggregated",
    ];
    const velo = new Velo({ apiKey: "test/key", baseUrl: feed.baseUrl });
    const seen: RawChannelMessage[] = [];
    const watcher = await velo.watch(velo.channels.subscribe(names), {
      on: { data: (value) => seen.push(value) },
    });
    try {
      expect(feed.upgrades).toHaveLength(1);
      expect(feed.upgrades[0]?.url).toBe("/api/w/connect");
      expect(feed.upgrades[0]?.headers.authorization).toBe(`Basic ${btoa("api:test/key")}`);
      await until(() => feed.sent.length === 2, "both raw subscriptions");
      expect(feed.sent).toEqual(names.map((name) => `s2 ${name}`));
      const frames = names.map((c) => ({ c, d: [1, 2, 3], tt: 123, f: false }));
      frames.forEach((frame) => feed.push(frame));
      await until(() => seen.length === 2, "both raw messages");
      expect(seen).toEqual(
        frames.map((raw) => ({ kind: "raw", channel: raw.c, timestamp: raw.tt, data: raw.d, raw })),
      );
    } finally {
      watcher.close();
    }
    await until(() => feed.sent.length === 4, "both unsubscriptions");
    expect(feed.sent.slice(2)).toEqual(names.map((name) => `u2 ${name}`));
  });

  it("sends the encoded API key in the native WebSocket URL for on-demand channels", async ({
    feed,
  }) => {
    const channel = "ondemand_hyperliquid_linear_BTC_candle_1";
    const velo = new Velo({
      apiKey: "test/key +?",
      baseUrl: feed.baseUrl,
      webSocketFactory: (target) =>
        defaultWebSocketFactory(target, { WebSocket: globalThis.WebSocket }),
    });
    const seen: RawChannelMessage[] = [];
    const watcher = await velo.watch(velo.channels.subscribe([channel]), {
      on: { data: (value) => seen.push(value) },
    });
    try {
      expect(feed.upgrades[0]?.url).toBe("/api/o/connect/test%2Fkey%20%2B%3F");
      expect(feed.upgrades[0]?.headers.authorization).toBeUndefined();
      await until(() => feed.sent.length === 1, "native subscription");
      const frame = { c: channel, d: [1, 2, 3], tt: 123, f: false };
      feed.push(frame);
      await until(() => seen.length === 1, "native data");
      expect(seen).toEqual([
        { kind: "raw", channel, timestamp: frame.tt, data: frame.d, raw: frame },
      ]);
    } finally {
      watcher.close();
    }
  });

  it("does not retry raw channels rejected by API-key authentication", async ({ refusing }) => {
    const velo = new Velo({ apiKey: "test/key", baseUrl: refusing.baseUrl });
    await expect(
      velo.watch(velo.channels.subscribe(["realtime_binance-futures:BTCUSDT"])),
    ).rejects.toBeInstanceOf(VeloAuthError);
    expect(refusing.attempts()).toBe(1);
  });

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
