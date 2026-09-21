import type { WebSocketTransport } from "../../transport/websocket.ts";

/**
 * The socket endpoints watchers connect through.
 *
 * Built once per client. A watcher takes the ones its subscription needs and
 * never constructs its own, so every socket a client opens shares one
 * credential and factory configuration.
 */
export interface WatchTransports {
  /* The v1 news feed. Shares realtime's path but stays on `baseUrl`. */
  readonly news: WebSocketTransport;
  /* Realtime channels at `/api/w/connect`, rehosted by `channelsBaseUrl`. */
  readonly realtime: WebSocketTransport;
  /* On-demand channels at `/api/o/connect`, rehosted by `channelsBaseUrl`. */
  readonly ondemand: WebSocketTransport;
}
