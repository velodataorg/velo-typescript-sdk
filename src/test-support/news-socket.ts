import { NewsWatcherController } from "../client/api/news/watcher.ts";
import type { NewsWatcher, NewsWatchOptions } from "../client/api/news/watcher.ts";
import { Velo } from "../client/client.ts";
import type { WatchOptions } from "../client/watch/registry.ts";
import { NEWS_WEBSOCKET_PATH } from "../constants/endpoints.ts";
import { WebSocketTransport } from "../transport/websocket.ts";
import type {
  WebSocketConnection,
  WebSocketEvents,
  WebSocketFactory,
  WebSocketTarget,
} from "../transport/websocket.ts";

/**
 * Shared fixtures for the live-subscription tests.
 *
 * News is the only watchable kind, so the watch-layer tests use its feed as
 * their vehicle; the fakes and harness live here rather than in either suite
 * so neither owns the other's setup.
 */

export const STORY = {
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

export function harness(factory?: WebSocketFactory) {
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
  const transport = new WebSocketTransport(config, NEWS_WEBSOCKET_PATH, webSocketFactory);
  const newsWatcher = (options?: NewsWatchOptions): NewsWatcher =>
    new NewsWatcherController(transport, options);
  return { client, sockets, targets, newsWatcher };
}

export async function flushConnection(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/**
 * Executes a feed subscription through the client and drives its socket open.
 *
 * The boundary a consumer actually uses: `velo.watch()` connects on its own,
 * so an opened watcher is what the client hands back.
 */
export async function openFeed(
  client: Velo,
  sockets: FakeSocket[],
  options?: WatchOptions<"news.feed">,
): Promise<{ watcher: NewsWatcher; socket: FakeSocket }> {
  const pending = client.watch(client.news.feed(), options);
  await flushConnection();
  const socket = sockets[sockets.length - 1] as FakeSocket;
  socket.open();
  return { watcher: await pending, socket };
}

export function story(id: number = STORY.id): string {
  return JSON.stringify({ ...STORY, id });
}
