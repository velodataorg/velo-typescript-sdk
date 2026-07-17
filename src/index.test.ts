import { describe, expect, it } from "vitest";

import {
  DEFAULT_NEWS_HEARTBEAT_TIMEOUT,
  EXCHANGES,
  FUTURES_COLUMNS,
  NEWS_PATH,
  NEWS_WEBSOCKET_PATH,
  VeloError,
  VeloRateLimitError,
} from "./index.js";
import type { NewsWatcherEvents, NewsWatcherListener, WebSocketFactory } from "./index.js";

describe("public entry", () => {
  it("exports API constants", () => {
    expect(EXCHANGES).toContain("binance-futures");
    expect(FUTURES_COLUMNS).toContain("funding_rate");
    expect(NEWS_PATH).toBe("/api/n/news");
    expect(NEWS_WEBSOCKET_PATH).toBe("/api/w/connect");
    expect(DEFAULT_NEWS_HEARTBEAT_TIMEOUT).toBe(300_000);
  });

  it("exports the error hierarchy", () => {
    expect(new VeloRateLimitError("x")).toBeInstanceOf(VeloError);
  });

  it("accepts a native WebSocket as a custom factory", () => {
    const factory: WebSocketFactory = (target) => new WebSocket(target.authenticatedUrl);
    expect(factory).toBeTypeOf("function");
  });

  it("exports the typed News watcher event map", () => {
    const listener: NewsWatcherListener<"delete"> = (event) => {
      const id: number = event.id;
      expect(id).toBe(1);
    };
    const event: NewsWatcherEvents["delete"] = { id: 1 };
    listener(event);
  });
});
