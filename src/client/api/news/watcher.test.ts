import { afterEach, describe, expect, it, vi } from "vitest";
import NodeWebSocket from "ws";

import { VeloConnectionError, VeloError } from "../../../errors.ts";
import {
  FakeSocket,
  flushConnection,
  SynchronouslyFailingSendSocket,
  ThrowingAttachSocket,
  ThrowingSendSocket,
} from "../../../transport/fake-socket.ts";
import { MAX_TIMER_MS } from "../../../transport/retry.ts";
import type {
  WebSocketConnection,
  WebSocketFactory,
  WebSocketTarget,
} from "../../../transport/websocket.ts";
import { harness, openFeed, story, STORY } from "./fixtures.ts";
import type { NewsStory } from "./validation.ts";
import { DEFAULT_NEWS_CONNECT_TIMEOUT, DEFAULT_NEWS_HEARTBEAT_TIMEOUT } from "./watcher.ts";
import type { NewsClose, NewsDelete, NewsWatcherState } from "./watcher.ts";

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

  it("delivers frames that arrive with open, in order, before connect resolves", async () => {
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

  it("rejects the connection when a frame arriving with open is malformed", async () => {
    const { client, sockets } = harness();
    const stories = vi.fn();
    const events: string[] = [];

    const pending = client.watch(client.news.feed(), {
      reconnect: false,
      on: {
        story: stories,
        error: () => events.push("error"),
        close: () => events.push("close"),
      },
    });
    await flushConnection();
    const socket = sockets[0] as FakeSocket;
    socket.openWithMessages("{not json", story(99));

    await expect(pending).rejects.toThrow(/invalid JSON/);
    expect(events).toEqual(["close"]);
    expect(stories).not.toHaveBeenCalled();
    expect(socket.closeCalls).toHaveLength(1);
    expect(sockets).toHaveLength(1);
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
      client.watch(client.news.feed(), {
        reconnect: false,
        on: { error: errors, close: closes },
      }),
    ).rejects.toThrow(/cannot connect/);

    expect(errors).not.toHaveBeenCalled();
    expect(closes).toHaveBeenCalledWith({ code: 1006, reason: "", wasClean: false });
  });

  it("rejects a subscription send failure and closes its socket", async () => {
    const socket = new ThrowingSendSocket();
    const { client } = harness(() => socket);
    const errors = vi.fn();
    const closes = vi.fn();

    const pending = client.watch(client.news.feed(), {
      reconnect: false,
      on: { error: errors, close: closes },
    });
    await flushConnection();
    socket.open();

    await expect(pending).rejects.toThrow(/cannot subscribe/);
    expect(errors).not.toHaveBeenCalled();
    expect(closes).toHaveBeenCalledOnce();
    expect(socket.closeCalls).toHaveLength(1);
  });

  it("retries a connection that fails synchronously during send", async () => {
    vi.useFakeTimers();
    const firstSocket = new SynchronouslyFailingSendSocket();
    const secondSocket = new FakeSocket();
    let attempts = 0;
    const { client } = harness(() => (attempts++ === 0 ? firstSocket : secondSocket));

    const pending = client.watch(client.news.feed(), {
      reconnect: { retries: 1, baseDelayMs: 0, maxDelayMs: 0 },
    });
    await flushConnection();
    firstSocket.open();
    await flushConnection();

    expect(firstSocket.closeCalls).toHaveLength(1);

    /* The same execution stays pending and owns the retry; the caller does
     * not need to execute the request again to regain access to its watcher.
     */
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toBe(2);
    secondSocket.open();
    const watcher = await pending;

    expect(watcher.state).toBe("open");
    watcher.close();
  });

  it("rejects a socket attachment failure instead of leaving connect pending", async () => {
    const socket = new ThrowingAttachSocket();
    const { client } = harness(() => socket);
    const errors = vi.fn();
    const closes = vi.fn();

    await expect(
      client.watch(client.news.feed(), {
        reconnect: false,
        on: { error: errors, close: closes },
      }),
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

  it("closes silently from idle and cannot connect afterward", async () => {
    const { newsWatcher, sockets } = harness();
    const watcher = newsWatcher();
    const closes: NewsClose[] = [];
    watcher.on("close", (event) => closes.push(event));

    watcher.close();
    watcher.close();

    expect(watcher.state).toBe("closed");
    expect(closes).toEqual([]);
    expect(sockets).toHaveLength(0);
    await expect(watcher.connect()).rejects.toThrow(/closed/);
  });

  it("does not emit another close when permanently closing an idle watcher", async () => {
    const { client, sockets } = harness();
    const { watcher } = await openFeed(client, sockets, { reconnect: false });
    const closes = vi.fn();
    watcher.on("close", closes);

    watcher.disconnect();
    watcher.close();

    expect(watcher.state).toBe("closed");
    expect(closes).toHaveBeenCalledOnce();
    expect(closes).toHaveBeenCalledWith({ code: 1000, reason: "", wasClean: true });
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

  it("permanently closes a disconnected watcher without duplicating its close event", async () => {
    const { client, sockets } = harness();
    const { watcher, socket } = await openFeed(client, sockets, { reconnect: false });
    const closes = vi.fn();
    watcher.on("close", closes);

    socket.remoteClose(1006, "gone");
    watcher.close();

    expect(watcher.state).toBe("closed");
    expect(closes).toHaveBeenCalledOnce();
    expect(closes).toHaveBeenCalledWith({ code: 1006, reason: "gone", wasClean: false });
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
      .watch(client.news.feed(), {
        reconnect: false,
        on: { close: closes, error: errors },
      })
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
      .watch(client.news.feed(), { connectTimeout: 100, reconnect: false })
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
