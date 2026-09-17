import type { WebSocketConnection, WebSocketEvents } from "./websocket.ts";

/**
 * In-memory sockets for tests.
 *
 * Implements the connection surface the SDK uses and lets a test drive the
 * server's side of it by hand: open, deliver frames, error, close. The
 * variants fail at one specific point each.
 */

type Listener = (event: unknown) => void;

export class FakeSocket implements WebSocketConnection {
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

export class ThrowingSendSocket extends FakeSocket {
  override send(): void {
    throw new Error("cannot subscribe");
  }
}

export class SynchronouslyFailingSendSocket extends FakeSocket {
  override send(data: string): void {
    super.send(data);
    this.error(new Error("synchronous send failure"));
  }
}

export class ThrowingAttachSocket extends FakeSocket {
  override addEventListener<K extends keyof WebSocketEvents>(
    _type: K,
    _listener: (event: WebSocketEvents[K]) => void,
  ): void {
    throw new Error("cannot attach listeners");
  }
}

/**
 * Lets a pending socket factory and the handshake continuation run.
 *
 * Two microtask turns: one for the factory promise, one for the session that
 * wraps the socket it produced.
 */
export async function flushConnection(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
