import { NEWS_WEBSOCKET_PATH } from "../../../constants/endpoints.ts";
import { FakeSocket, flushConnection } from "../../../transport/fake-socket.ts";
import { WebSocketTransport } from "../../../transport/websocket.ts";
import type { WebSocketFactory, WebSocketTarget } from "../../../transport/websocket.ts";
import { Velo } from "../../client.ts";
import type { WatchOptions } from "../../watch/registry.ts";
import { NewsWatcherController } from "./watcher.ts";
import type { NewsWatcher, NewsWatchOptions } from "./watcher.ts";

/**
 * Test fixtures for the news feed: a client over fake sockets, and stories.
 *
 * The watch-layer tests use the news feed as their vehicle, so they share
 * these rather than building a second harness.
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
