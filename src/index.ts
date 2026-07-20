export type { Caps, CapsParams } from "./client/caps/caps.js";
export type { MarketCap } from "./client/caps/schema.js";
export { CAPS_COLUMNS } from "./client/caps/schema.js";
export type { VeloConfig } from "./client/client.js";
export { Velo } from "./client/client.js";
export {
  BASE_URL,
  CAPS_PATH,
  FUTURES_CATALOG_PATH,
  NEWS_PATH,
  NEWS_WEBSOCKET_PATH,
  ROWS_PATH,
  SPOT_CATALOG_PATH,
  TERMS_PATH,
} from "./constants.js";
export {
  VeloAuthError,
  VeloBadRequestError,
  VeloConnectionError,
  VeloError,
  VeloHttpError,
  VeloRateLimitError,
  VeloRequestError,
  VeloServerError,
  VeloTimeoutError,
} from "./errors.js";
export { DEFAULT_TIMEOUT } from "./transport/http.js";
export type { HttpParams, HttpRequestOptions } from "./transport/http.js";
export { DEFAULT_RETRY } from "./transport/retry.js";
export type { RetryOptions } from "./transport/retry.js";
export type {
  WebSocketCloseEvent,
  WebSocketConnection,
  WebSocketErrorEvent,
  WebSocketEvents,
  WebSocketFactory,
  WebSocketMessageEvent,
  WebSocketTarget,
} from "./transport/websocket.js";
