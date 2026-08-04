import { afterEach, describe, expect, it, vi } from "vitest";
import NodeWebSocket from "ws";

import { VeloConnectionError, VeloError } from "../../../errors.ts";
import { MAX_TIMER_MS } from "../../../transport/retry.ts";
import type {
  WebSocketConnection,
  WebSocketEvents,
  WebSocketFactory,
  WebSocketTarget,
} from "../../../transport/websocket.ts";
import { Velo } from "../../client.ts";
import type { NewsStory } from "./validation.ts";
import { DEFAULT_NEWS_CONNECT_TIMEOUT, DEFAULT_NEWS_HEARTBEAT_TIMEOUT } from "./watcher.ts";
import type { NewsClose, NewsDelete, NewsWatcher, NewsWatcherState } from "./watcher.ts";

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
} as const;

type Listener = (event: unknown) => void;

class FakeSocket implements WebSocketConnection {
  readonly closeCalls: { code: number | undefined; reason: string | undefined }[] = [];
  readonly sent: string[] = [];
  readonly #listeners: Record<keyof WebSocketEvents, Set<Listener>> = {
    open: new Set(),
    message: new Set(),
    error: new Set(),
    close: new Set(),
  };

  readyState = 0;

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
    this.readyState = 3;
  }

  addEventListener<K extends keyof WebSocketEvents>(
    type: K,
    listener: (event: WebSocketEvents[K]) => void,
  ): void {
    this.#listeners[type].add(listener as Listener);
  }

  removeEventListener<K extends keyof WebSocketEvents>(
    type: K,
    listener: (event: WebSocketEvents[K]) => void,
  ): void {
    this.#listeners[type].delete(listener as Listener);
  }

  open(): void {
    this.readyState = 1;
    this.#emit("open", {});
  }

  openWithMessages(...messages: unknown[]): void {
    this.open();
    for (const message of messages) this.message(message);
  }

  message(data: unknown): void {
    this.#emit("message", { data });
  }

  error(error: unknown): void {
    this.#emit("error", {
      error,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  remoteClose(code = 1006, reason = ""): void {
    this.readyState = 3;
    this.#emit("close", { code, reason, wasClean: code === 1000 });
  }

  listenerCount(type: keyof WebSocketEvents): number {
    return this.#listeners[type].size;
  }

  #emit<K extends keyof WebSocketEvents>(type: K, event: WebSocketEvents[K]): void {
    for (const listener of Array.from(this.#listeners[type])) listener(event);
  }
}

class ThrowingSendSocket extends FakeSocket {
  override send(): void {
    throw new Error("cannot subscribe");
  }
}

class SynchronouslyFailingSendSocket extends FakeSocket {
  override send(data: string): void {
    super.send(data);
    this.error(new Error("synchronous send failure"));
  }
}

class ThrowingAttachSocket extends FakeSocket {
  override addEventListener<K extends keyof WebSocketEvents>(
    _type: K,
    _listener: (event: WebSocketEvents[K]) => void,
  ): void {
    throw new Error("cannot attach listeners");
  }
}

function harness(factory?: WebSocketFactory) {
  const sockets: FakeSocket[] = [];
  const targets: WebSocketTarget[] = [];
  const webSocketFactory: WebSocketFactory =
    factory ??
    ((target) => {
      targets.push(target);
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    });
  const client = new Velo({
    apiKey: "test/key",
    fetch: async () => new Response('{"stories":[]}'),
    webSocketFactory,
  });
  return { client, sockets, targets };
}

async function flushConnection(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function openWatcher(watcher: NewsWatcher, sockets: FakeSocket[]): Promise<FakeSocket> {
  const connected = watcher.connect();
  await flushConnection();
  const socket = sockets[0] as FakeSocket;
  socket.open();
  await connected;
  return socket;
}

function story(id: number = STORY.id): string {
  return JSON.stringify({ ...STORY, id });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Velo.watch over the news feed", () => {
  it("creates a disconnected idle watcher and validates options synchronously", () => {
    const { client, sockets } = harness();
    const watcher = client.watch(client.news.feed());

    expect(watcher.state).toBe("idle");
    expect(sockets).toHaveLength(0);
    expect("stream" in client.news).toBe(false);

    const invalid: unknown[] = [
      null,
      [],
      { heartbeatTimeout: 0 },
      { heartbeatTimeout: -1 },
      { heartbeatTimeout: 0.5 },
      { heartbeatTimeout: Number.NaN },
      { heartbeatTimeout: Symbol("timeout") },
      { heartbeatTimeout: MAX_TIMER_MS + 1 },
      { connectTimeout: 0 },
      { connectTimeout: -1 },
      { connectTimeout: 0.5 },
      { connectTimeout: MAX_TIMER_MS + 1 },
      { onListenerError: "log" },
      { onListenerError: null },
      { signal: {} },
      { signal: { aborted: false, addEventListener() {} } },
      {
        signal: {
          aborted: "false",
          addEventListener() {},
          removeEventListener() {},
        },
      },
    ];
    for (const options of invalid) {
      expect(() => client.watch(client.news.feed(), options as never)).toThrow(VeloError);
    }
    expect(sockets).toHaveLength(0);
  });

  it("connects explicitly, shares one attempt, and subscribes exactly once", async () => {
    const { client, sockets, targets } = harness();
    const watcher = client.watch(client.news.feed());

    const first = watcher.connect();
    const second = watcher.connect();
    expect(first).toBe(second);
    expect(watcher.state).toBe("connecting");
    expect(sockets).toHaveLength(1);

    await flushConnection();
    const socket = sockets[0] as FakeSocket;
    expect(socket.sent).toEqual([]);
    socket.open();
    socket.open();

    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
    expect(watcher.state).toBe("open");
    expect(watcher.connect()).toBe(first);
    expect(socket.sent).toEqual(["subscribe news_priority"]);
    expect(targets[0]?.authenticatedUrl).toContain("/api/w/connect/test%2Fkey");
  });

  it("replays frames emitted synchronously with open in their original order", async () => {
    const { client, sockets } = harness();
    const watcher = client.watch(client.news.feed());
    const events: string[] = [];
    watcher.on("story", ({ id }) => events.push(`story:${String(id)}`));

    const connected = watcher.connect().then(() => {
      events.push("connected");
    });
    await flushConnection();
    const socket = sockets[0] as FakeSocket;

    socket.openWithMessages(story(1), story(2));
    await connected;

    expect(watcher.state).toBe("open");
    expect(socket.sent).toEqual(["subscribe news_priority"]);
    expect(events).toEqual(["story:1", "story:2", "connected"]);
  });

  it("stops draining after a buffered frame fails and never replays stale frames", async () => {
    const { client, sockets } = harness();
    const watcher = client.watch(client.news.feed());
    const stories = vi.fn();
    const events: string[] = [];
    watcher
      .on("story", stories)
      .on("error", () => events.push("error"))
      .on("close", () => events.push("close"));

    const connected = watcher.connect();
    await flushConnection();
    const firstSocket = sockets[0] as FakeSocket;
    firstSocket.openWithMessages("{not json", story(99));
    await expect(connected).resolves.toBeUndefined();

    expect(watcher.state).toBe("disconnected");
    expect(events).toEqual(["error", "close"]);
    expect(stories).not.toHaveBeenCalled();

    const reconnected = watcher.connect();
    await flushConnection();
    const secondSocket = sockets[1] as FakeSocket;
    secondSocket.openWithMessages(story(2));
    await reconnected;

    expect(watcher.state).toBe("open");
    expect(stories).toHaveBeenCalledOnce();
    expect(stories).toHaveBeenCalledWith({ ...STORY, id: 2 });
    watcher.close();
  });

  it("emits decoded domain events in order and supports fluent on/off", async () => {
    const { client, sockets } = harness();
    const watcher = client.watch(client.news.feed());
    const received: (readonly [string, unknown])[] = [];
    const removed = vi.fn();
    const storyListener = (value: NewsStory): void => {
      received.push(["story", value]);
    };

    expect(watcher.on("story", storyListener)).toBe(watcher);
    watcher.on("story", storyListener);
    expect(watcher.on("story", removed).off("story", removed)).toBe(watcher);
    watcher
      .on("edit", (value) => received.push(["edit", value]))
      .on("delete", (value) => received.push(["delete", value]));

    const socket = await openWatcher(watcher, sockets);
    socket.message(JSON.stringify({ ...STORY, futureField: true }));
    socket.message(JSON.stringify({ ...STORY, headline: "Edited", edit: true }));
    socket.message(JSON.stringify({ id: STORY.id, deleted: true }));

    expect(received).toEqual([
      ["story", STORY],
      ["edit", { ...STORY, headline: "Edited" }],
      ["delete", { id: STORY.id }],
    ]);
    expect(removed).not.toHaveBeenCalled();
  });

  it("consumes heartbeats internally and accepts Node Buffer frames", async () => {
    const { client, sockets } = harness();
    const watcher = client.watch(client.news.feed());
    const stories = vi.fn();
    const edits = vi.fn();
    const deletions = vi.fn();
    watcher.on("story", stories).on("edit", edits).on("delete", deletions);
    const socket = await openWatcher(watcher, sockets);

    socket.message('{"heartbeat":true}');
    expect(stories).not.toHaveBeenCalled();
    expect(edits).not.toHaveBeenCalled();
    expect(deletions).not.toHaveBeenCalled();

    socket.message(Buffer.from(story()));
    expect(stories).toHaveBeenCalledWith(STORY);
  });

  it("reports a post-open decode failure as error then close", async () => {
    const { client, sockets } = harness();
    const watcher = client.watch(client.news.feed());
    const order: string[] = [];
    let surfaced: VeloError | undefined;
    watcher
      .on("error", (error) => {
        order.push("error");
        surfaced = error;
        expect(watcher.state).toBe("disconnected");
      })
      .on("close", () => {
        order.push("close");
        expect(watcher.state).toBe("disconnected");
      });
    const socket = await openWatcher(watcher, sockets);

    socket.message("{not json");

    expect(order).toEqual(["error", "close"]);
    expect(surfaced).toBeInstanceOf(VeloError);
    expect(surfaced?.message).toMatch(/invalid JSON/);
    expect(surfaced?.cause).toBeInstanceOf(SyntaxError);
    expect(socket.closeCalls).toHaveLength(1);
    expect(socket.listenerCount("message")).toBe(0);
  });

  it("rejects setup failures without duplicating them through the error event", async () => {
    const connectionFailure = new VeloConnectionError("cannot connect", {
      url: "wss://api.velo.xyz/api/w/connect",
    });
    const { client } = harness(() => {
      throw connectionFailure;
    });
    const watcher = client.watch(client.news.feed());
    const errors = vi.fn();
    const closes = vi.fn();
    watcher.on("error", errors).on("close", closes);

    await expect(watcher.connect()).rejects.toThrow(/cannot connect/);
    expect(watcher.state).toBe("disconnected");
    expect(errors).not.toHaveBeenCalled();
    expect(closes).toHaveBeenCalledWith({ code: 1006, reason: "", wasClean: false });
  });

  it("rejects a subscription send failure and closes its socket", async () => {
    const socket = new ThrowingSendSocket();
    const { client } = harness(() => socket);
    const watcher = client.watch(client.news.feed());
    const errors = vi.fn();
    const closes = vi.fn();
    watcher.on("error", errors).on("close", closes);

    const connected = watcher.connect();
    await flushConnection();
    socket.open();

    await expect(connected).rejects.toThrow(/cannot subscribe/);
    expect(watcher.state).toBe("disconnected");
    expect(errors).not.toHaveBeenCalled();
    expect(closes).toHaveBeenCalledOnce();
    expect(socket.closeCalls).toHaveLength(1);
  });

  it("does not revive a connection that fails synchronously during send", async () => {
    const firstSocket = new SynchronouslyFailingSendSocket();
    const secondSocket = new FakeSocket();
    let attempts = 0;
    const { client } = harness(() => (attempts++ === 0 ? firstSocket : secondSocket));
    const watcher = client.watch(client.news.feed());

    const connected = watcher.connect();
    await flushConnection();
    firstSocket.open();

    await expect(connected).rejects.toThrow(/synchronous send failure/);
    expect(watcher.state).toBe("disconnected");
    expect(firstSocket.closeCalls).toHaveLength(1);

    const reconnected = watcher.connect();
    await flushConnection();
    secondSocket.open();
    await expect(reconnected).resolves.toBeUndefined();
    expect(watcher.state).toBe("open");
    watcher.close();
  });

  it("rejects a socket attachment failure instead of leaving connect pending", async () => {
    const socket = new ThrowingAttachSocket();
    const { client } = harness(() => socket);
    const watcher = client.watch(client.news.feed());
    const errors = vi.fn();
    const closes = vi.fn();
    watcher.on("error", errors).on("close", closes);

    await expect(watcher.connect()).rejects.toThrow(/cannot attach listeners/);

    expect(watcher.state).toBe("disconnected");
    expect(errors).not.toHaveBeenCalled();
    expect(closes).toHaveBeenCalledWith({ code: 1006, reason: "", wasClean: false });
    expect(socket.closeCalls).toHaveLength(1);
  });

  it("redacts credentials and emits one terminal outcome for a remote close", async () => {
    const { client, sockets, targets } = harness();
    const watcher = client.watch(client.news.feed());
    const errors: VeloError[] = [];
    const closes: NewsClose[] = [];
    watcher.on("error", (error) => errors.push(error)).on("close", (close) => closes.push(close));
    const socket = await openWatcher(watcher, sockets);
    const target = targets[0] as WebSocketTarget;

    socket.remoteClose(1008, `bad test/key test%2Fkey ${target.headers.authorization as string}`);
    socket.error(new Error("late"));

    expect(errors).toHaveLength(1);
    expect(closes).toEqual([
      { code: 1008, reason: "bad [REDACTED] [REDACTED] Basic [REDACTED]", wasClean: false },
    ]);
    const surfaced = [errors[0]?.message, errors[0]?.stack, closes[0]?.reason].join("\n");
    expect(surfaced).toContain("[REDACTED]");
    expect(surfaced).not.toContain("test/key");
    expect(surfaced).not.toContain("test%2Fkey");
    expect(surfaced).not.toContain(target.headers.authorization);
  });

  it("settles an error/close race once and does not reconnect automatically", async () => {
    const { client, sockets } = harness();
    const watcher = client.watch(client.news.feed());
    const order: string[] = [];
    watcher.on("error", () => order.push("error")).on("close", () => order.push("close"));
    const socket = await openWatcher(watcher, sockets);

    socket.error(new Error("socket failed"));
    socket.remoteClose(1006, "gone");

    expect(order).toEqual(["error", "close"]);
    expect(watcher.state).toBe("disconnected");
    expect(sockets).toHaveLength(1);
    expect(socket.closeCalls).toHaveLength(1);
    await flushConnection();
    expect(sockets).toHaveLength(1);
  });

  it("reconnects explicitly from a close listener and preserves listeners", async () => {
    const { client, sockets } = harness();
    const watcher = client.watch(client.news.feed());
    const stories = vi.fn();
    let reconnected: Promise<void> | undefined;
    watcher.on("story", stories).on("close", () => {
      if (watcher.state === "disconnected") {
        reconnected = watcher.connect();
      }
    });
    const firstSocket = await openWatcher(watcher, sockets);

    firstSocket.remoteClose(1006, "gone");

    expect(watcher.state).toBe("connecting");
    await flushConnection();
    expect(sockets).toHaveLength(2);
    const secondSocket = sockets[1] as FakeSocket;
    secondSocket.open();
    await expect(reconnected).resolves.toBeUndefined();
    expect(watcher.state).toBe("open");
    expect(secondSocket.sent).toEqual(["subscribe news_priority"]);

    secondSocket.message(story(2));
    expect(stories).toHaveBeenCalledWith({ ...STORY, id: 2 });

    watcher.close();
  });

  it("keeps independent watchers and listener sets", async () => {
    const { client, sockets } = harness();
    const first = client.watch(client.news.feed());
    const second = client.watch(client.news.feed());
    const firstStories = vi.fn();
    const secondStories = vi.fn();
    first.on("story", firstStories);
    second.on("story", secondStories);

    const firstConnected = first.connect();
    const secondConnected = second.connect();
    await flushConnection();
    expect(sockets).toHaveLength(2);
    sockets[0]?.open();
    sockets[1]?.open();
    await Promise.all([firstConnected, secondConnected]);

    sockets[0]?.message(story(1));
    sockets[1]?.message(story(2));
    expect(firstStories).toHaveBeenCalledWith({ ...STORY, id: 1 });
    expect(secondStories).toHaveBeenCalledWith({ ...STORY, id: 2 });
  });

  it("does not reclassify listener exceptions as watcher failures", async () => {
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    const { client, sockets } = harness();
    const watcher = client.watch(client.news.feed());
    const later = vi.fn();
    const thrown = new Error("consumer failed");
    watcher
      .on("story", () => {
        throw thrown;
      })
      .on("story", later);
    const socket = await openWatcher(watcher, sockets);

    socket.message(story());

    expect(reportError).toHaveBeenCalledWith(thrown);
    expect(later).toHaveBeenCalledWith(STORY);
    expect(watcher.state).toBe("open");
  });

  it("reports rejected listener promises without failing the watcher", async () => {
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    const { client, sockets } = harness();
    const watcher = client.watch(client.news.feed());
    const later = vi.fn();
    const rejected = new Error("async consumer failed");
    watcher
      .on("story", async () => {
        throw rejected;
      })
      .on("story", later);
    const socket = await openWatcher(watcher, sockets);

    socket.message(story());
    await flushConnection();

    expect(reportError).toHaveBeenCalledWith(rejected);
    expect(later).toHaveBeenCalledWith(STORY);
    expect(watcher.state).toBe("open");
  });

  it("routes listener failures to onListenerError instead of the default reporting", async () => {
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    const onListenerError = vi.fn();
    const { client, sockets } = harness();
    const watcher = client.watch(client.news.feed(), { onListenerError });
    const later = vi.fn();
    const thrown = new Error("consumer failed");
    watcher
      .on("story", () => {
        throw thrown;
      })
      .on("story", later);
    const socket = await openWatcher(watcher, sockets);

    socket.message(story());

    expect(onListenerError).toHaveBeenCalledWith(thrown);
    expect(reportError).not.toHaveBeenCalled();
    expect(later).toHaveBeenCalledWith(STORY);
    expect(watcher.state).toBe("open");
  });
});

describe("News watcher lifecycle", () => {
  it("disconnects intentionally, preserves listeners, and reconnects from idle", async () => {
    const { client, sockets } = harness();
    const watcher = client.watch(client.news.feed());
    const stories = vi.fn();
    const closes: NewsClose[] = [];
    const closeListener = (event: NewsClose): void => {
      closes.push(event);
      expect(watcher.state).toBe("idle");
    };
    watcher.on("story", stories).on("close", closeListener);
    const firstSocket = await openWatcher(watcher, sockets);

    watcher.disconnect();
    watcher.disconnect();
    firstSocket.message(story(1));

    expect(watcher.state).toBe("idle");
    expect(firstSocket.closeCalls).toHaveLength(1);
    expect(firstSocket.listenerCount("message")).toBe(0);
    expect(closes).toEqual([{ code: 1000, reason: "", wasClean: true }]);
    expect(stories).not.toHaveBeenCalled();
    await flushConnection();
    expect(sockets).toHaveLength(1);

    const reconnected = watcher.connect();
    await flushConnection();
    const secondSocket = sockets[1] as FakeSocket;
    secondSocket.open();
    await reconnected;
    secondSocket.message(story(2));

    expect(watcher.state).toBe("open");
    expect(secondSocket.sent).toEqual(["subscribe news_priority"]);
    expect(stories).toHaveBeenCalledWith({ ...STORY, id: 2 });

    watcher.off("close", closeListener);
    watcher.close();
  });

  it("rejects a disconnected connection attempt and ignores its late socket", async () => {
    const resolvers: ((socket: WebSocketConnection) => void)[] = [];
    const factory: WebSocketFactory = () =>
      new Promise((resolve) => {
        resolvers.push(resolve);
      });
    const { client } = harness(factory);
    const watcher = client.watch(client.news.feed());
    const first = watcher.connect();

    watcher.disconnect();

    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(watcher.state).toBe("idle");

    const second = watcher.connect();
    const staleSocket = new FakeSocket();
    resolvers[0]?.(staleSocket);
    await flushConnection();

    expect(staleSocket.closeCalls).toHaveLength(1);
    expect(watcher.state).toBe("connecting");

    const currentSocket = new FakeSocket();
    resolvers[1]?.(currentSocket);
    await flushConnection();
    currentSocket.open();
    await second;

    expect(watcher.state).toBe("open");
    expect(currentSocket.sent).toEqual(["subscribe news_priority"]);

    watcher.close();
  });

  it("closes cleanly from idle and cannot connect afterward", async () => {
    const { client, sockets } = harness();
    const watcher = client.watch(client.news.feed());
    const closes: NewsClose[] = [];
    watcher.on("close", (event) => closes.push(event));

    watcher.close();
    watcher.close();

    expect(watcher.state).toBe("closed");
    expect(closes).toEqual([{ code: 1000, reason: "", wasClean: true }]);
    expect(sockets).toHaveLength(0);
    await expect(watcher.connect()).rejects.toThrow(/closed/);
  });

  it("closes while connecting, rejects the shared attempt, and handles a late socket", async () => {
    let resolveSocket: ((socket: WebSocketConnection) => void) | undefined;
    const factory: WebSocketFactory = () =>
      new Promise((resolve) => {
        resolveSocket = resolve;
      });
    const { client } = harness(factory);
    const watcher = client.watch(client.news.feed());
    const closes = vi.fn();
    const errors = vi.fn();
    watcher.on("close", closes).on("error", errors);
    const first = watcher.connect();
    const second = watcher.connect();

    watcher.close();

    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await expect(second).rejects.toMatchObject({ name: "AbortError" });
    expect(watcher.state).toBe("closed");
    expect(errors).not.toHaveBeenCalled();
    expect(closes).toHaveBeenCalledWith({ code: 1000, reason: "", wasClean: true });

    const socket = new FakeSocket();
    resolveSocket?.(socket);
    await flushConnection();
    expect(socket.closeCalls).toHaveLength(1);
    expect(socket.sent).toEqual([]);
  });

  it("safely closes a real Node ws while it is still connecting", async () => {
    const factory: WebSocketFactory = () =>
      new NodeWebSocket("ws://127.0.0.1:1") as unknown as WebSocketConnection;
    const { client } = harness(factory);
    const watcher = client.watch(client.news.feed());
    const connected = watcher.connect();

    watcher.close();

    await expect(connected).rejects.toMatchObject({ name: "AbortError" });
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  it("closes cleanly from open, detaches transport listeners, and is idempotent", async () => {
    const { client, sockets } = harness();
    const watcher = client.watch(client.news.feed());
    const stories = vi.fn();
    const errors = vi.fn();
    const closes = vi.fn();
    watcher.on("story", stories).on("error", errors).on("close", closes);
    const socket = await openWatcher(watcher, sockets);

    watcher.close();
    watcher.close();
    socket.message(story());
    socket.error(new Error("late"));

    expect(watcher.state).toBe("closed");
    expect(socket.closeCalls).toHaveLength(1);
    expect(socket.listenerCount("message")).toBe(0);
    expect(stories).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    expect(closes).toHaveBeenCalledTimes(1);
    expect(closes).toHaveBeenCalledWith({ code: 1000, reason: "", wasClean: true });
  });

  it("does not connect with an already-aborted signal", async () => {
    const reason = new Error("stop");
    const controller = new AbortController();
    controller.abort(reason);
    const { client, sockets } = harness();
    const watcher = client.watch(client.news.feed(), { signal: controller.signal });
    const closes = vi.fn();
    const errors = vi.fn();
    watcher.on("close", closes).on("error", errors);

    await expect(watcher.connect()).rejects.toBe(reason);

    expect(watcher.state).toBe("closed");
    expect(sockets).toHaveLength(0);
    expect(errors).not.toHaveBeenCalled();
    expect(closes).toHaveBeenCalledWith({ code: 1000, reason: "", wasClean: true });
  });

  it("aborts cleanly while open", async () => {
    const reason = new Error("stop");
    const controller = new AbortController();
    const { client, sockets } = harness();
    const watcher = client.watch(client.news.feed(), { signal: controller.signal });
    const closes = vi.fn();
    const errors = vi.fn();
    watcher.on("close", closes).on("error", errors);
    const socket = await openWatcher(watcher, sockets);

    controller.abort(reason);

    expect(watcher.state).toBe("closed");
    expect(socket.closeCalls).toHaveLength(1);
    expect(errors).not.toHaveBeenCalled();
    expect(closes).toHaveBeenCalledWith({ code: 1000, reason: "", wasClean: true });
  });

  it("uses a five-minute default and fails after the heartbeat deadline", async () => {
    vi.useFakeTimers();
    const { client, sockets } = harness();
    const watcher = client.watch(client.news.feed());
    const events: string[] = [];
    watcher
      .on("error", (error) => events.push(error.message))
      .on("close", () => events.push("close"));
    const socket = await openWatcher(watcher, sockets);

    await vi.advanceTimersByTimeAsync(DEFAULT_NEWS_HEARTBEAT_TIMEOUT - 1);
    expect(watcher.state).toBe("open");
    await vi.advanceTimersByTimeAsync(1);

    expect(watcher.state).toBe("disconnected");
    expect(events[0]).toMatch(/300000 milliseconds/);
    expect(events[1]).toBe("close");
    expect(socket.closeCalls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(DEFAULT_NEWS_HEARTBEAT_TIMEOUT * 2);
    expect(sockets).toHaveLength(1);
  });

  it("resets the deadline only for heartbeat messages", async () => {
    vi.useFakeTimers();
    const { client, sockets } = harness();
    const watcher = client.watch(client.news.feed());
    const stories = vi.fn();
    const errors = vi.fn();
    watcher.on("story", stories).on("error", errors);
    const socket = await openWatcher(watcher, sockets);

    await vi.advanceTimersByTimeAsync(DEFAULT_NEWS_HEARTBEAT_TIMEOUT - 1);
    socket.message('{"heartbeat":true}');
    await vi.advanceTimersByTimeAsync(DEFAULT_NEWS_HEARTBEAT_TIMEOUT - 1);
    expect(watcher.state).toBe("open");

    socket.message(story());
    expect(stories).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(watcher.state).toBe("disconnected");
    expect(errors).toHaveBeenCalledOnce();
  });

  it("honors a custom heartbeat timeout", async () => {
    vi.useFakeTimers();
    const { client, sockets } = harness();
    const watcher = client.watch(client.news.feed(), { heartbeatTimeout: 100 });
    const socket = await openWatcher(watcher, sockets);

    await vi.advanceTimersByTimeAsync(99);
    expect(watcher.state).toBe("open");
    await vi.advanceTimersByTimeAsync(1);

    expect(watcher.state).toBe("disconnected");
    expect(socket.closeCalls).toHaveLength(1);
  });

  it("uses a thirty-second default and fails a connection attempt that never opens", async () => {
    vi.useFakeTimers();
    const { client, sockets } = harness();
    const watcher = client.watch(client.news.feed());
    const closes = vi.fn();
    const errors = vi.fn();
    watcher.on("close", closes).on("error", errors);

    const connected = watcher.connect();
    const outcome = connected.catch((error: unknown) => error);
    await flushConnection();
    const socket = sockets[0] as FakeSocket;

    await vi.advanceTimersByTimeAsync(DEFAULT_NEWS_CONNECT_TIMEOUT - 1);
    expect(watcher.state).toBe("connecting");
    await vi.advanceTimersByTimeAsync(1);

    const error = await outcome;
    expect(error).toBeInstanceOf(VeloConnectionError);
    expect((error as Error).message).toMatch(/timed out connecting after 30000 milliseconds/);
    expect(watcher.state).toBe("disconnected");
    expect(errors).not.toHaveBeenCalled();
    expect(closes).toHaveBeenCalledWith({ code: 1006, reason: "", wasClean: false });
    expect(socket.closeCalls).toHaveLength(1);

    // A handshake after the deadline cannot revive the watcher.
    socket.open();
    expect(watcher.state).toBe("disconnected");
  });

  it("honors a custom connect timeout", async () => {
    vi.useFakeTimers();
    const { client } = harness();
    const watcher = client.watch(client.news.feed(), { connectTimeout: 100 });

    const connected = watcher.connect();
    const outcome = connected.catch((error: unknown) => error);
    await flushConnection();

    await vi.advanceTimersByTimeAsync(99);
    expect(watcher.state).toBe("connecting");
    await vi.advanceTimersByTimeAsync(1);

    expect((await outcome) as Error).toBeInstanceOf(VeloConnectionError);
    expect(watcher.state).toBe("disconnected");
  });

  it("keeps the connection once open past the connect deadline", async () => {
    vi.useFakeTimers();
    const { client, sockets } = harness();
    const watcher = client.watch(client.news.feed(), { connectTimeout: 1000 });
    const closes = vi.fn();
    watcher.on("close", closes);
    const socket = await openWatcher(watcher, sockets);

    await vi.advanceTimersByTimeAsync(10_000);

    expect(watcher.state).toBe("open");
    expect(closes).not.toHaveBeenCalled();
    expect(socket.closeCalls).toHaveLength(0);
  });

  it("exposes the state union without widening it to string", () => {
    const { client } = harness();
    const watcher = client.watch(client.news.feed());
    const state: NewsWatcherState = watcher.state;
    const deletion: NewsDelete = { id: 1 };

    expect(state).toBe("idle");
    expect(deletion.id).toBe(1);
  });
});

describe("Velo.watch", () => {
  it("describes a feed without connecting, then executes it with listeners attached", async () => {
    const { client, sockets } = harness();

    /* news.feed() only describes: no socket until the client executes it. */
    expect(client.news.feed().build()).toEqual({ kind: "news.feed", params: {} });
    expect(sockets).toHaveLength(0);
    expect("watch" in client.news).toBe(false);

    /* Listeners passed as arguments are registered before connect(), so no
     * event can be missed between construction and the first message.
     */
    const seen: NewsStory[] = [];
    const watcher = client.watch(client.news.feed(), {
      on: { story: (event) => seen.push(event) },
    });

    expect(watcher.state).toBe("idle");
    expect(sockets).toHaveLength(0);

    const socket = await openWatcher(watcher, sockets);
    socket.message(story());

    expect(seen.map((event) => event.id)).toEqual([STORY.id]);
  });

  it("keeps the execution verbs disjoint", () => {
    const { client } = harness();

    /* Checked by the compiler, never executed: a query request cannot be
     * watched, and a subscription cannot be fetched over HTTP.
     */
    const rejected = (): void => {
      // @ts-expect-error news.stories is not watchable
      client.watch(client.news.stories());
      // @ts-expect-error news.feed is not queryable
      void client.query(client.news.feed());
      // @ts-expect-error news.feed is not streamable
      void client.stream(client.news.feed());
    };

    expect(rejected).toBeTypeOf("function");
  });

  it("accepts one listener for every event, discriminated by type", async () => {
    const { client, sockets } = harness();
    const seen: string[] = [];

    const watcher = client.watch(client.news.feed(), {
      on: (event) => {
        switch (event.type) {
          case "story":
            seen.push(`story:${event.event.headline}`);
            break;
          case "delete":
            seen.push(`delete:${event.event.id}`);
            break;
          default:
            seen.push(event.type);
        }
      },
    });

    const socket = await openWatcher(watcher, sockets);
    socket.message(JSON.stringify(STORY));
    socket.message(JSON.stringify({ ...STORY, headline: "Edited", edit: true }));
    socket.message(JSON.stringify({ id: STORY.id, deleted: true }));

    expect(seen).toEqual([`story:${STORY.headline}`, "edit", `delete:${STORY.id}`]);
  });
});
