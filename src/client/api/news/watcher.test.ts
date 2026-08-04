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
import { WebSocketTransport } from "../../../transport/websocket.ts";
import { Velo } from "../../client.ts";
import type { WatchOptions } from "../../watch.ts";
import type { NewsStory } from "./validation.ts";
import {
  DEFAULT_NEWS_CONNECT_TIMEOUT,
  DEFAULT_NEWS_HEARTBEAT_TIMEOUT,
  NewsWatcherController,
} from "./watcher.ts";
import type {
  NewsClose,
  NewsDelete,
  NewsWatcher,
  NewsWatcherState,
  NewsWatchOptions,
} from "./watcher.ts";

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
  const config = {
    apiKey: "test/key",
    fetch: async () => new Response('{"stories":[]}'),
    webSocketFactory,
  };
  const client = new Velo(config);
  /* A few behaviours are only reachable before the subscription opens —
   * closing or aborting mid-connect, connect timeouts — which the client no
   * longer exposes now that watch() connects. Those drive the controller
   * directly; everything else goes through the client.
   */
  const transport = new WebSocketTransport(config, webSocketFactory);
  const newsWatcher = (options: NewsWatchOptions = {}): NewsWatcher =>
    new NewsWatcherController(transport, options);
  return { client, sockets, targets, newsWatcher };
}

async function flushConnection(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/**
 * Executes a feed subscription through the client and drives its socket open.
 *
 * The boundary a consumer actually uses: `velo.watch()` connects on its own,
 * so an opened watcher is what the client hands back.
 */
async function openFeed(
  client: Velo,
  sockets: FakeSocket[],
  options: WatchOptions<"news.feed"> = {},
): Promise<{ watcher: NewsWatcher; socket: FakeSocket }> {
  const pending = client.watch(client.news.feed(), options);
  await flushConnection();
  const socket = sockets[sockets.length - 1] as FakeSocket;
  socket.open();
  return { watcher: await pending, socket };
}

function story(id: number = STORY.id): string {
  return JSON.stringify({ ...STORY, id });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("News feed subscription", () => {
  it("validates watch options synchronously, before anything connects", () => {
    const { client, sockets } = harness();

    expect("watch" in client.news).toBe(false);

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
    const { newsWatcher, sockets, targets } = harness();
    const watcher = newsWatcher();

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
    const events: string[] = [];

    const connected = client
      .watch(client.news.feed(), {
        on: { story: ({ id }) => events.push(`story:${String(id)}`) },
      })
      .then((opened) => {
        events.push("connected");
        return opened;
      });
    await flushConnection();
    const socket = sockets[0] as FakeSocket;

    socket.openWithMessages(story(1), story(2));
    const watcher = await connected;

    expect(watcher.state).toBe("open");
    expect(socket.sent).toEqual(["subscribe news_priority"]);
    expect(events).toEqual(["story:1", "story:2", "connected"]);
  });

  it("stops draining after a buffered frame fails and never replays stale frames", async () => {
    const { client, sockets } = harness();
    const stories = vi.fn();
    const events: string[] = [];

    const pending = client.watch(client.news.feed(), {
      on: {
        story: stories,
        error: () => events.push("error"),
        close: () => events.push("close"),
      },
    });
    await flushConnection();
    const firstSocket = sockets[0] as FakeSocket;
    firstSocket.openWithMessages("{not json", story(99));
    const watcher = await pending;

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
    const { watcher, socket } = await openFeed(client, sockets);
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
    const { watcher, socket } = await openFeed(client, sockets);
    const stories = vi.fn();
    const edits = vi.fn();
    const deletions = vi.fn();
    watcher.on("story", stories).on("edit", edits).on("delete", deletions);

    socket.message('{"heartbeat":true}');
    expect(stories).not.toHaveBeenCalled();
    expect(edits).not.toHaveBeenCalled();
    expect(deletions).not.toHaveBeenCalled();

    socket.message(Buffer.from(story()));
    expect(stories).toHaveBeenCalledWith(STORY);
  });

  it("reports a post-open decode failure as error then close", async () => {
    const { client, sockets } = harness();
    const { watcher, socket } = await openFeed(client, sockets, { reconnect: false });
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
    const errors = vi.fn();
    const closes = vi.fn();

    await expect(
      client.watch(client.news.feed(), { on: { error: errors, close: closes } }),
    ).rejects.toThrow(/cannot connect/);

    expect(errors).not.toHaveBeenCalled();
    expect(closes).toHaveBeenCalledWith({ code: 1006, reason: "", wasClean: false });
  });

  it("rejects a subscription send failure and closes its socket", async () => {
    const socket = new ThrowingSendSocket();
    const { client } = harness(() => socket);
    const errors = vi.fn();
    const closes = vi.fn();

    const pending = client.watch(client.news.feed(), { on: { error: errors, close: closes } });
    await flushConnection();
    socket.open();

    await expect(pending).rejects.toThrow(/cannot subscribe/);
    expect(errors).not.toHaveBeenCalled();
    expect(closes).toHaveBeenCalledOnce();
    expect(socket.closeCalls).toHaveLength(1);
  });

  it("does not revive a connection that fails synchronously during send", async () => {
    const firstSocket = new SynchronouslyFailingSendSocket();
    const secondSocket = new FakeSocket();
    let attempts = 0;
    const { client } = harness(() => (attempts++ === 0 ? firstSocket : secondSocket));

    const pending = client.watch(client.news.feed());
    await flushConnection();
    firstSocket.open();

    await expect(pending).rejects.toThrow(/synchronous send failure/);
    expect(firstSocket.closeCalls).toHaveLength(1);

    /* A failed watch() hands back no watcher, so retrying means executing the
     * request again — which must reach a working socket.
     */
    const retried = client.watch(client.news.feed());
    await flushConnection();
    secondSocket.open();
    const watcher = await retried;

    expect(watcher.state).toBe("open");
    watcher.close();
  });

  it("rejects a socket attachment failure instead of leaving connect pending", async () => {
    const socket = new ThrowingAttachSocket();
    const { client } = harness(() => socket);
    const errors = vi.fn();
    const closes = vi.fn();

    await expect(
      client.watch(client.news.feed(), { on: { error: errors, close: closes } }),
    ).rejects.toThrow(/cannot attach listeners/);

    expect(errors).not.toHaveBeenCalled();
    expect(closes).toHaveBeenCalledWith({ code: 1006, reason: "", wasClean: false });
    expect(socket.closeCalls).toHaveLength(1);
  });

  it("redacts credentials and emits one terminal outcome for a remote close", async () => {
    const { client, sockets, targets } = harness();
    const { watcher, socket } = await openFeed(client, sockets);
    const errors: VeloError[] = [];
    const closes: NewsClose[] = [];
    watcher.on("error", (error) => errors.push(error)).on("close", (close) => closes.push(close));
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

  it("settles an error/close race once and stays down when reconnection is off", async () => {
    const { client, sockets } = harness();
    const { watcher, socket } = await openFeed(client, sockets, { reconnect: false });
    const order: string[] = [];
    watcher.on("error", () => order.push("error")).on("close", () => order.push("close"));

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
    const { watcher, socket } = await openFeed(client, sockets);
    const stories = vi.fn();
    let reconnected: Promise<void> | undefined;
    watcher.on("story", stories).on("close", () => {
      if (watcher.state === "disconnected") {
        reconnected = watcher.connect();
      }
    });
    const firstSocket = socket;

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
    const firstStories = vi.fn();
    const secondStories = vi.fn();

    const first = client.watch(client.news.feed(), { on: { story: firstStories } });
    const second = client.watch(client.news.feed(), { on: { story: secondStories } });
    await flushConnection();
    expect(sockets).toHaveLength(2);
    sockets[0]?.open();
    sockets[1]?.open();
    await Promise.all([first, second]);

    sockets[0]?.message(story(1));
    sockets[1]?.message(story(2));
    expect(firstStories).toHaveBeenCalledWith({ ...STORY, id: 1 });
    expect(secondStories).toHaveBeenCalledWith({ ...STORY, id: 2 });
  });

  it("does not reclassify listener exceptions as watcher failures", async () => {
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    const { client, sockets } = harness();
    const { watcher, socket } = await openFeed(client, sockets);
    const later = vi.fn();
    const thrown = new Error("consumer failed");
    watcher
      .on("story", () => {
        throw thrown;
      })
      .on("story", later);

    socket.message(story());

    expect(reportError).toHaveBeenCalledWith(thrown);
    expect(later).toHaveBeenCalledWith(STORY);
    expect(watcher.state).toBe("open");
  });

  it("reports rejected listener promises without failing the watcher", async () => {
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    const { client, sockets } = harness();
    const { watcher, socket } = await openFeed(client, sockets);
    const later = vi.fn();
    const rejected = new Error("async consumer failed");
    watcher
      .on("story", async () => {
        throw rejected;
      })
      .on("story", later);

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
    const { watcher, socket } = await openFeed(client, sockets, { onListenerError });
    const later = vi.fn();
    const thrown = new Error("consumer failed");
    watcher
      .on("story", () => {
        throw thrown;
      })
      .on("story", later);

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
    const { watcher, socket } = await openFeed(client, sockets);
    const stories = vi.fn();
    const closes: NewsClose[] = [];
    const closeListener = (event: NewsClose): void => {
      closes.push(event);
      expect(watcher.state).toBe("idle");
    };
    watcher.on("story", stories).on("close", closeListener);
    const firstSocket = socket;

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
    const { newsWatcher } = harness(factory);
    const watcher = newsWatcher();
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
    const { newsWatcher, sockets } = harness();
    const watcher = newsWatcher();
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
    const { newsWatcher } = harness(factory);
    const watcher = newsWatcher();
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
    const { newsWatcher } = harness(factory);
    const watcher = newsWatcher();
    const connected = watcher.connect();

    watcher.close();

    await expect(connected).rejects.toMatchObject({ name: "AbortError" });
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  it("closes cleanly from open, detaches transport listeners, and is idempotent", async () => {
    const { client, sockets } = harness();
    const { watcher, socket } = await openFeed(client, sockets);
    const stories = vi.fn();
    const errors = vi.fn();
    const closes = vi.fn();
    watcher.on("story", stories).on("error", errors).on("close", closes);

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
    const closes = vi.fn();
    const errors = vi.fn();

    await expect(
      client.watch(client.news.feed(), {
        signal: controller.signal,
        on: { close: closes, error: errors },
      }),
    ).rejects.toBe(reason);

    expect(sockets).toHaveLength(0);
    expect(errors).not.toHaveBeenCalled();
    expect(closes).toHaveBeenCalledWith({ code: 1000, reason: "", wasClean: true });
  });

  it("aborts cleanly while open", async () => {
    const reason = new Error("stop");
    const controller = new AbortController();
    const { client, sockets } = harness();
    const { watcher, socket } = await openFeed(client, sockets, { signal: controller.signal });
    const closes = vi.fn();
    const errors = vi.fn();
    watcher.on("close", closes).on("error", errors);

    controller.abort(reason);

    expect(watcher.state).toBe("closed");
    expect(socket.closeCalls).toHaveLength(1);
    expect(errors).not.toHaveBeenCalled();
    expect(closes).toHaveBeenCalledWith({ code: 1000, reason: "", wasClean: true });
  });

  it("uses a five-minute default and fails after the heartbeat deadline", async () => {
    vi.useFakeTimers();
    const { client, sockets } = harness();
    const { watcher, socket } = await openFeed(client, sockets, { reconnect: false });
    const events: string[] = [];
    watcher
      .on("error", (error) => events.push(error.message))
      .on("close", () => events.push("close"));

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
    const { watcher, socket } = await openFeed(client, sockets);
    const stories = vi.fn();
    const errors = vi.fn();
    watcher.on("story", stories).on("error", errors);

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
    const { watcher, socket } = await openFeed(client, sockets, { heartbeatTimeout: 100 });

    await vi.advanceTimersByTimeAsync(99);
    expect(watcher.state).toBe("open");
    await vi.advanceTimersByTimeAsync(1);

    expect(watcher.state).toBe("disconnected");
    expect(socket.closeCalls).toHaveLength(1);
  });

  it("uses a thirty-second default and fails a connection attempt that never opens", async () => {
    vi.useFakeTimers();
    const { client, sockets } = harness();
    const closes = vi.fn();
    const errors = vi.fn();

    const outcome = client
      .watch(client.news.feed(), { on: { close: closes, error: errors } })
      .catch((error: unknown) => error);
    await flushConnection();
    const socket = sockets[0] as FakeSocket;

    await vi.advanceTimersByTimeAsync(DEFAULT_NEWS_CONNECT_TIMEOUT - 1);
    expect(socket.closeCalls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);

    const error = await outcome;
    expect(error).toBeInstanceOf(VeloConnectionError);
    expect((error as Error).message).toMatch(/timed out connecting after 30000 milliseconds/);
    expect(errors).not.toHaveBeenCalled();
    expect(closes).toHaveBeenCalledWith({ code: 1006, reason: "", wasClean: false });
    expect(socket.closeCalls).toHaveLength(1);

    // A handshake after the deadline cannot revive the subscription.
    socket.open();
    expect(closes).toHaveBeenCalledTimes(1);
    expect(socket.sent).toEqual([]);
  });

  it("honors a custom connect timeout", async () => {
    vi.useFakeTimers();
    const { client, sockets } = harness();

    const outcome = client
      .watch(client.news.feed(), { connectTimeout: 100 })
      .catch((error: unknown) => error);
    await flushConnection();
    const socket = sockets[0] as FakeSocket;

    await vi.advanceTimersByTimeAsync(99);
    expect(socket.closeCalls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);

    expect((await outcome) as Error).toBeInstanceOf(VeloConnectionError);
    expect(socket.closeCalls).toHaveLength(1);
  });

  it("keeps the connection once open past the connect deadline", async () => {
    vi.useFakeTimers();
    const { client, sockets } = harness();
    const { watcher, socket } = await openFeed(client, sockets, { connectTimeout: 1000 });
    const closes = vi.fn();
    watcher.on("close", closes);

    await vi.advanceTimersByTimeAsync(10_000);

    expect(watcher.state).toBe("open");
    expect(closes).not.toHaveBeenCalled();
    expect(socket.closeCalls).toHaveLength(0);
  });

  it("exposes the state union without widening it to string", async () => {
    const { client, sockets } = harness();
    const { watcher } = await openFeed(client, sockets);
    const state: NewsWatcherState = watcher.state;
    const deletion: NewsDelete = { id: 1 };

    expect(state).toBe("open");
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

    /* Listeners passed as arguments are registered before the socket opens,
     * so no event can be missed between execution and the first message.
     */
    const seen: NewsStory[] = [];
    const pending = client.watch(client.news.feed(), {
      on: { story: (event) => seen.push(event) },
    });

    await flushConnection();
    const socket = sockets[0] as FakeSocket;
    socket.open();
    await pending;

    socket.message(story());

    expect(seen.map((event) => event.id)).toEqual([STORY.id]);
  });

  it("connects when the request is executed, with no explicit connect()", async () => {
    const { client, sockets } = harness();
    const seen: string[] = [];

    /* watch() executes, exactly as query() does: the subscription is opening
     * before anything is awaited.
     */
    const pending = client.watch(client.news.feed(), {
      on: { story: (event) => seen.push(event.headline) },
    });
    await flushConnection();
    expect(sockets).toHaveLength(1);

    const socket = sockets[0] as FakeSocket;
    socket.open();
    const watcher = await pending;

    expect(watcher.state).toBe("open");

    socket.message(JSON.stringify(STORY));
    expect(seen).toEqual([STORY.headline]);
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

    const pending = client.watch(client.news.feed(), {
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

    await flushConnection();
    const socket = sockets[0] as FakeSocket;
    socket.open();
    await pending;

    socket.message(JSON.stringify(STORY));
    socket.message(JSON.stringify({ ...STORY, headline: "Edited", edit: true }));
    socket.message(JSON.stringify({ id: STORY.id, deleted: true }));

    expect(seen).toEqual([`story:${STORY.headline}`, "edit", `delete:${STORY.id}`]);
  });
});

describe("News feed reconnection", () => {
  it("reconnects on its own after an unexpected drop", async () => {
    vi.useFakeTimers();
    const { client, sockets } = harness();
    const stories = vi.fn();
    const { watcher, socket } = await openFeed(client, sockets, { on: { story: stories } });

    /* An unexpected drop is infrastructure's problem, not the consumer's:
     * nothing in the app has to call connect() for the feed to resume.
     */
    socket.remoteClose(1006, "gone");
    await vi.advanceTimersByTimeAsync(1_000);

    expect(sockets).toHaveLength(2);
    const resumed = sockets[1] as FakeSocket;
    resumed.open();
    await flushConnection();

    expect(watcher.state).toBe("open");
    expect(resumed.sent).toEqual(["subscribe news_priority"]);

    resumed.message(story(2));
    expect(stories).toHaveBeenCalledWith({ ...STORY, id: 2 });
    watcher.close();
  });

  it("stays down after a drop when reconnection is disabled", async () => {
    vi.useFakeTimers();
    const { client, sockets } = harness();
    const { watcher, socket } = await openFeed(client, sockets, { reconnect: false });

    socket.remoteClose(1006, "gone");
    await vi.advanceTimersByTimeAsync(120_000);

    expect(sockets).toHaveLength(1);
    expect(watcher.state).toBe("disconnected");
  });

  it("backs off between attempts and resumes when the socket comes back", async () => {
    vi.useFakeTimers();
    const { client, sockets } = harness();
    const { watcher, socket } = await openFeed(client, sockets, {
      reconnect: { baseDelayMs: 1_000, maxDelayMs: 8_000 },
    });

    socket.remoteClose(1006, "gone");

    /* Backoff is jittered to half the nominal delay at minimum, so nothing
     * reconnects before that floor.
     */
    await vi.advanceTimersByTimeAsync(400);
    expect(sockets).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets).toHaveLength(2);

    /* A failed attempt schedules the next one rather than giving up. */
    (sockets[1] as FakeSocket).remoteClose(1006, "still gone");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sockets.length).toBeGreaterThanOrEqual(3);

    const live = sockets[sockets.length - 1] as FakeSocket;
    live.open();
    await flushConnection();

    expect(watcher.state).toBe("open");
    watcher.close();
  });

  it("does not reconnect after an intentional close or disconnect", async () => {
    vi.useFakeTimers();
    const { client, sockets } = harness();
    const first = await openFeed(client, sockets);

    first.watcher.disconnect();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(1);

    const second = await openFeed(client, sockets);
    second.watcher.close();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(2);
  });
});
