import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FakeSocket,
  flushConnection,
  harness,
  openFeed,
  story,
  STORY,
} from "../../test-support/news-socket.ts";
import { DEFAULT_RETRY } from "../../transport/retry.ts";
import type { NewsStory } from "../api/news/validation.ts";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Velo.watch", () => {
  it("keeps the initial execution pending through retries, then rejects at the limit", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const { client } = harness(() => {
      attempts++;
      throw new Error("server unavailable");
    });

    let settled = false;
    const outcome = client
      .watch(client.news.feed(), {
        reconnect: { retries: 2, baseDelayMs: 100, maxDelayMs: 100 },
      })
      .then(
        () => {
          settled = true;
          return undefined;
        },
        (error: unknown) => {
          settled = true;
          return error;
        },
      );

    await flushConnection();
    expect(attempts).toBe(1);
    expect(settled).toBe(false);

    await vi.runAllTimersAsync();

    expect(await outcome).toMatchObject({ message: expect.stringContaining("server unavailable") });
    expect(settled).toBe(true);
    expect(attempts).toBe(3);

    /* Once watch() rejects, its unreachable watcher has stopped for good. */
    await vi.advanceTimersByTimeAsync(60_000);
    expect(attempts).toBe(3);
  });

  it("settles rather than retrying an initial connection forever", async () => {
    vi.useFakeTimers();
    let dials = 0;
    const { client } = harness(() => {
      dials++;
      throw new Error("connection refused");
    });

    let settled = false;
    void client.watch(client.news.feed()).then(
      () => (settled = true),
      () => (settled = true),
    );

    /* Five minutes is far longer than any transient outage a caller would
     * wait through before wanting an error they can act on.
     */
    await vi.advanceTimersByTimeAsync(5 * 60_000);

    expect(settled).toBe(true);
    /* One dial plus the default redials, so a change to that default is a
     * change to this test rather than a silent loosening.
     */
    expect(dials).toBe(DEFAULT_RETRY.retries + 1);
  });

  it("resolves with the watcher when an initial retry connects", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const { client } = harness(() => {
      attempts++;
      if (attempts < 3) throw new Error("temporarily unavailable");

      const socket = new FakeSocket();
      socket.readyState = 1;
      return socket;
    });

    const pending = client.watch(client.news.feed(), {
      reconnect: { retries: 2, baseDelayMs: 100, maxDelayMs: 100 },
    });

    await vi.advanceTimersByTimeAsync(1_000);
    const watcher = await pending;

    expect(attempts).toBe(3);
    expect(watcher.state).toBe("open");
    watcher.close();
  });

  it("gives a later drop a fresh retry budget after an initial retry succeeds", async () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    let attempts = 0;
    const { client } = harness(() => {
      attempts++;
      if (attempts === 1) throw new Error("temporarily unavailable");

      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    });

    const pending = client.watch(client.news.feed(), {
      reconnect: { retries: 1, baseDelayMs: 0, maxDelayMs: 0 },
    });
    await vi.advanceTimersByTimeAsync(0);
    const firstConnection = sockets[0] as FakeSocket;
    firstConnection.open();
    const watcher = await pending;

    firstConnection.remoteClose(1006, "gone");
    await vi.advanceTimersByTimeAsync(0);

    expect(attempts).toBe(3);
    const secondConnection = sockets[1] as FakeSocket;
    secondConnection.open();
    await flushConnection();
    expect(watcher.state).toBe("open");
    watcher.close();
  });

  it("recovers a drop that occurs as the first connection settles", async () => {
    vi.useFakeTimers();
    const { client, sockets } = harness();
    const pending = client.watch(client.news.feed(), {
      reconnect: { retries: 1, baseDelayMs: 0, maxDelayMs: 0 },
    });
    await flushConnection();

    /* The socket opens, but a buffered malformed frame drops it before the
     * successful connect() continuation gets to run.
     */
    (sockets[0] as FakeSocket).openWithMessages("{not json");
    const watcher = await pending;
    expect(watcher.state).toBe("disconnected");

    await vi.advanceTimersByTimeAsync(0);
    expect(sockets).toHaveLength(2);

    (sockets[1] as FakeSocket).open();
    await flushConnection();
    expect(watcher.state).toBe("open");
    watcher.close();
  });

  it("aborts an initial retry sequence without another connection attempt", async () => {
    vi.useFakeTimers();
    const reason = new Error("stop waiting");
    const controller = new AbortController();
    let attempts = 0;
    const { client } = harness(() => {
      attempts++;
      throw new Error("server unavailable");
    });

    const pending = client.watch(client.news.feed(), {
      signal: controller.signal,
      reconnect: { baseDelayMs: 1_000, maxDelayMs: 1_000 },
    });

    await flushConnection();
    expect(attempts).toBe(1);

    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(attempts).toBe(1);
  });

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

  it("releases every abort listener when a disconnected watcher is closed", async () => {
    const controller = new AbortController();
    const addAbortListener = vi.spyOn(controller.signal, "addEventListener");
    const removeAbortListener = vi.spyOn(controller.signal, "removeEventListener");
    const { client, sockets } = harness();
    const { watcher, socket } = await openFeed(client, sockets, {
      signal: controller.signal,
      reconnect: false,
    });

    socket.remoteClose(1006, "gone");
    watcher.close();

    expect(removeAbortListener.mock.calls).toHaveLength(addAbortListener.mock.calls.length);
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

  it("keeps retrying past any bounded budget once a connection has succeeded", async () => {
    vi.useFakeTimers();
    const { client, sockets } = harness();
    const { socket } = await openFeed(client, sockets, {
      connectTimeout: 100,
      reconnect: { baseDelayMs: 100, maxDelayMs: 100 },
    });

    socket.remoteClose(1006, "gone");
    await vi.advanceTimersByTimeAsync(60_000);

    expect(sockets.length).toBeGreaterThan(10);
  });

  it("stops reconnecting once the attempt budget is spent", async () => {
    vi.useFakeTimers();
    const { client, sockets } = harness();
    /* Short deadlines so each failed attempt resolves inside the window. */
    const { socket } = await openFeed(client, sockets, {
      connectTimeout: 100,
      reconnect: { retries: 2, baseDelayMs: 100, maxDelayMs: 100 },
    });

    socket.remoteClose(1006, "gone");
    await vi.advanceTimersByTimeAsync(60_000);

    /* The original socket plus exactly two retries, then it gives up. */
    expect(sockets).toHaveLength(3);
  });

  it("starts a fresh budget after an explicit connection recovers an exhausted watcher", async () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    let attempts = 0;
    const { client } = harness(() => {
      attempts++;
      if (attempts === 2) throw new Error("still down");

      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    });

    const pending = client.watch(client.news.feed(), {
      reconnect: { retries: 1, baseDelayMs: 0, maxDelayMs: 0 },
    });
    await flushConnection();
    (sockets[0] as FakeSocket).open();
    const watcher = await pending;

    (sockets[0] as FakeSocket).remoteClose(1006, "gone");
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toBe(2);
    expect(watcher.state).toBe("disconnected");

    const explicit = watcher.connect();
    await flushConnection();
    (sockets[1] as FakeSocket).open();
    await explicit;

    (sockets[1] as FakeSocket).remoteClose(1006, "gone again");
    await vi.advanceTimersByTimeAsync(0);

    /* Initial + exhausted retry + explicit recovery + automatic retry. */
    expect(attempts).toBe(4);
    (sockets[2] as FakeSocket).open();
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
