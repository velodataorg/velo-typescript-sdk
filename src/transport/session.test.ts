import { afterEach, describe, expect, it, vi } from "vitest";

import { REALTIME_WEBSOCKET_PATH } from "../constants/endpoints.ts";
import { VeloError } from "../errors.ts";
import { FakeSocket, SynchronouslyFailingSendSocket } from "./fake-socket.ts";
import { WebSocketSession } from "./session.ts";
import { WebSocketTransport } from "./websocket.ts";
import type {
  WebSocketCloseEvent,
  WebSocketConnection,
  WebSocketEvents,
  WebSocketFactory,
} from "./websocket.ts";

class PartiallyThrowingAttachSocket extends FakeSocket {
  override addEventListener<K extends keyof WebSocketEvents>(
    type: K,
    listener: (event: WebSocketEvents[K]) => void,
  ): void {
    if (type === "error") throw new Error("cannot attach error listener");
    super.addEventListener(type, listener);
  }
}

function sessionHarness(factory?: WebSocketFactory) {
  const sockets: FakeSocket[] = [];
  const transport = new WebSocketTransport(
    { apiKey: "test/key", baseUrl: "https://example.test" },
    REALTIME_WEBSOCKET_PATH,
    factory ??
      (() => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      }),
  );
  const messages: unknown[] = [];
  const closes: { close: WebSocketCloseEvent; error: VeloError }[] = [];
  const handlers = {
    onMessage: (data: unknown): void => {
      messages.push(data);
    },
    onClose: (close: WebSocketCloseEvent, error: VeloError): void => {
      closes.push({ close, error });
    },
  };
  return { transport, sockets, messages, closes, handlers };
}

async function flushConnection(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function openSession(harness: ReturnType<typeof sessionHarness>) {
  const opening = WebSocketSession.open(harness.transport, harness.handlers, { timeout: 5000 });
  await flushConnection();
  const socket = harness.sockets[0] as FakeSocket;
  socket.open();
  const session = await opening;
  return { session, socket };
}

describe("WebSocketSession", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens after the handshake and forwards frames from the first tick", async () => {
    const harness = sessionHarness();
    const opening = WebSocketSession.open(harness.transport, harness.handlers, { timeout: 5000 });
    await flushConnection();
    const socket = harness.sockets[0] as FakeSocket;

    // Both fire before the open() promise is awaited: nothing can be missed.
    socket.open();
    socket.message("early");

    const session = await opening;
    expect(session.state).toBe("open");
    expect(harness.messages).toEqual(["early"]);

    socket.message("later");
    expect(harness.messages).toEqual(["early", "later"]);
    expect(harness.closes).toEqual([]);
  });

  it("resolves for a factory socket that is already open", async () => {
    const harness = sessionHarness(() => {
      const socket = new FakeSocket();
      socket.readyState = 1;
      harness.sockets.push(socket);
      return socket;
    });
    const session = await WebSocketSession.open(harness.transport, harness.handlers, {
      timeout: 5000,
    });
    expect(session.state).toBe("open");
  });

  it("validates the timeout synchronously", () => {
    const harness = sessionHarness();
    for (const timeout of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => WebSocketSession.open(harness.transport, harness.handlers, { timeout })).toThrow(
        VeloError,
      );
    }
    expect(harness.sockets).toHaveLength(0);
  });

  it("times out when the handshake never completes", async () => {
    vi.useFakeTimers();
    const harness = sessionHarness();
    const opening = WebSocketSession.open(harness.transport, harness.handlers, { timeout: 5000 });
    const outcome = opening.catch((error: unknown) => error);
    await flushConnection();

    await vi.advanceTimersByTimeAsync(4999);
    const socket = harness.sockets[0] as FakeSocket;
    expect(socket.closeCalls).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    const error = await outcome;
    expect(error).toBeInstanceOf(VeloError);
    expect((error as Error).message).toMatch(/timed out connecting after 5000 milliseconds/);
    expect(socket.closeCalls).toHaveLength(1);
    expect(harness.closes).toEqual([]);

    // A handshake after the deadline cannot revive the attempt.
    socket.open();
    expect(harness.messages).toEqual([]);
  });

  it("times out when the factory never settles", async () => {
    vi.useFakeTimers();
    const harness = sessionHarness(() => new Promise<WebSocketConnection>(() => {}));
    const opening = WebSocketSession.open(harness.transport, harness.handlers, { timeout: 1000 });
    const outcome = opening.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(1000);
    const error = await outcome;
    expect(error).toBeInstanceOf(VeloError);
    expect((error as Error).message).toMatch(/timed out/);
  });

  it("closes a socket the factory delivers after the attempt already failed", async () => {
    vi.useFakeTimers();
    let deliver: ((socket: WebSocketConnection) => void) | undefined;
    const socket = new FakeSocket();
    const harness = sessionHarness(
      () =>
        new Promise<WebSocketConnection>((resolve) => {
          deliver = resolve;
        }),
    );
    const opening = WebSocketSession.open(harness.transport, harness.handlers, { timeout: 1000 });
    const outcome = opening.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(1000);
    (deliver as (socket: WebSocketConnection) => void)(socket);
    await flushConnection();

    expect(await outcome).toBeInstanceOf(VeloError);
    expect(socket.closeCalls).toHaveLength(1);
    expect(harness.closes).toEqual([]);
  });

  it("rejects when the factory fails without firing onClose", async () => {
    const harness = sessionHarness(() => {
      throw new Error("no socket");
    });
    await expect(
      WebSocketSession.open(harness.transport, harness.handlers, { timeout: 5000 }),
    ).rejects.toThrow(VeloError);
    expect(harness.closes).toEqual([]);
  });

  it("rolls back listeners when attachment fails partway", async () => {
    const socket = new PartiallyThrowingAttachSocket();
    const harness = sessionHarness(() => {
      harness.sockets.push(socket);
      return socket;
    });

    await expect(
      WebSocketSession.open(harness.transport, harness.handlers, { timeout: 5000 }),
    ).rejects.toThrow(/cannot attach error listener/);

    expect(socket.listenerCount("open")).toBe(0);
    expect(socket.listenerCount("message")).toBe(0);
    expect(socket.listenerCount("error")).toBe(0);
    expect(socket.listenerCount("close")).toBe(0);
    expect(socket.closeCalls).toHaveLength(1);
    expect(harness.messages).toEqual([]);
    expect(harness.closes).toEqual([]);

    socket.open();
    socket.message("late");
    expect(harness.messages).toEqual([]);
  });

  it("reports a pre-open remote close with its real code and rejects", async () => {
    const harness = sessionHarness();
    const opening = WebSocketSession.open(harness.transport, harness.handlers, { timeout: 5000 });
    const outcome = opening.catch((error: unknown) => error);
    await flushConnection();
    const socket = harness.sockets[0] as FakeSocket;

    socket.remoteClose(1008, "bad test/key");

    const error = await outcome;
    expect(error).toBeInstanceOf(VeloError);
    expect(harness.closes).toHaveLength(1);
    expect(harness.closes[0]?.close).toEqual({
      code: 1008,
      reason: "bad [REDACTED]",
      wasClean: false,
    });
    expect(harness.closes[0]?.error).toBe(error);
    expect((error as Error).message).toMatch(/code 1008/);
    expect((error as Error).message).not.toContain("test/key");
  });

  it("reports a pre-open socket error as an abnormal close and rejects", async () => {
    const harness = sessionHarness();
    const opening = WebSocketSession.open(harness.transport, harness.handlers, { timeout: 5000 });
    const outcome = opening.catch((error: unknown) => error);
    await flushConnection();
    const socket = harness.sockets[0] as FakeSocket;

    socket.error(new Error("refused"));

    const error = await outcome;
    expect(error).toBeInstanceOf(VeloError);
    expect((error as Error).message).toMatch(/refused/);
    expect(harness.closes).toHaveLength(1);
    expect(harness.closes[0]?.close).toEqual({ code: 1006, reason: "", wasClean: false });
    expect(socket.closeCalls).toHaveLength(1);
  });

  it("rejects a pre-open failure even when onClose throws", async () => {
    const harness = sessionHarness();
    const handlerFailure = new Error("close handler failed");
    const opening = WebSocketSession.open(
      harness.transport,
      {
        ...harness.handlers,
        onClose: () => {
          throw handlerFailure;
        },
      },
      { timeout: 5000 },
    );
    await flushConnection();
    const socket = harness.sockets[0] as FakeSocket;

    expect(() => socket.error(new Error("refused"))).toThrow(handlerFailure);
    await expect(opening).rejects.toThrow(/refused/);
    expect(socket.closeCalls).toHaveLength(1);
    expect(socket.listenerCount("error")).toBe(1);
    expect(socket.listenerCount("close")).toBe(0);
  });

  it("fires onClose exactly once for a post-open error and close race", async () => {
    const harness = sessionHarness();
    const { session, socket } = await openSession(harness);

    socket.error(new Error("socket failed"));
    socket.remoteClose(1006, "gone");

    expect(session.state).toBe("closed");
    expect(harness.closes).toHaveLength(1);
    expect(harness.closes[0]?.close).toEqual({ code: 1006, reason: "", wasClean: false });
    expect(socket.listenerCount("message")).toBe(0);
    expect(socket.listenerCount("close")).toBe(0);
  });

  it("passes a post-open remote close through with a redacted reason", async () => {
    const harness = sessionHarness();
    const { session, socket } = await openSession(harness);

    socket.remoteClose(1000, "done test/key");

    expect(session.state).toBe("closed");
    expect(harness.closes).toEqual([
      {
        close: { code: 1000, reason: "done [REDACTED]", wasClean: true },
        error: harness.closes[0]?.error,
      },
    ]);
    expect(harness.closes[0]?.error).toBeInstanceOf(VeloError);
  });

  it("close() detaches silently, is idempotent, and mutes late events", async () => {
    const harness = sessionHarness();
    const { session, socket } = await openSession(harness);

    session.close();
    session.close();

    expect(session.state).toBe("closed");
    expect(socket.closeCalls).toHaveLength(1);
    expect(socket.listenerCount("open")).toBe(0);
    expect(socket.listenerCount("message")).toBe(0);
    expect(socket.listenerCount("close")).toBe(0);

    socket.message("late");
    socket.remoteClose(1006, "late");
    expect(harness.messages).toEqual([]);
    expect(harness.closes).toEqual([]);
  });

  it("aborts a pending attempt through its signal", async () => {
    const harness = sessionHarness();
    const controller = new AbortController();
    const reason = new Error("attempt canceled");
    const opening = WebSocketSession.open(harness.transport, harness.handlers, {
      timeout: 5000,
      signal: controller.signal,
    });
    const outcome = opening.catch((error: unknown) => error);
    await flushConnection();

    controller.abort(reason);

    expect(await outcome).toBe(reason);
    expect((harness.sockets[0] as FakeSocket).closeCalls).toHaveLength(1);
    expect(harness.closes).toEqual([]);
  });

  it("rejects an already-aborted signal before invoking the factory", async () => {
    const factory = vi.fn();
    const harness = sessionHarness(factory as unknown as WebSocketFactory);
    const controller = new AbortController();
    const reason = new Error("never started");
    controller.abort(reason);

    await expect(
      WebSocketSession.open(harness.transport, harness.handlers, {
        timeout: 5000,
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
    expect(factory).not.toHaveBeenCalled();
  });

  it("rejects factory sockets that are already closing or nonsensical", async () => {
    for (const [readyState, pattern] of [
      [2, /closed before opening/],
      [3, /closed before opening/],
      [-1, /invalid readyState -1/],
    ] as const) {
      const harness = sessionHarness(() => {
        const socket = new FakeSocket();
        socket.readyState = readyState;
        harness.sockets.push(socket);
        return socket;
      });
      await expect(
        WebSocketSession.open(harness.transport, harness.handlers, { timeout: 5000 }),
      ).rejects.toThrow(pattern);
      expect(harness.closes).toEqual([]);
    }
  });

  it("keeps the session open past the timeout once the handshake is done", async () => {
    vi.useFakeTimers();
    const harness = sessionHarness();
    const opening = WebSocketSession.open(harness.transport, harness.handlers, { timeout: 5000 });
    await flushConnection();
    const socket = harness.sockets[0] as FakeSocket;
    socket.open();
    const session = await opening;

    await vi.advanceTimersByTimeAsync(60_000);

    expect(session.state).toBe("open");
    expect(harness.closes).toEqual([]);
    expect(socket.closeCalls).toHaveLength(0);
  });

  it("sends frames only while open", async () => {
    const harness = sessionHarness();
    const { session, socket } = await openSession(harness);

    session.send("subscribe");
    expect(socket.sent).toEqual(["subscribe"]);

    session.close();
    expect(() => session.send("again")).toThrow(/not open/);
    expect(socket.sent).toEqual(["subscribe"]);
  });

  it("survives a socket that terminates synchronously inside send()", async () => {
    const harness = sessionHarness(() => {
      const socket = new SynchronouslyFailingSendSocket();
      harness.sockets.push(socket);
      return socket;
    });
    const { session } = await openSession(harness);

    session.send("subscribe");

    expect(session.state).toBe("closed");
    expect(harness.closes).toHaveLength(1);
    expect(harness.closes[0]?.error.message).toMatch(/synchronous send failure/);
  });
});
