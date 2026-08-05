import { beforeEach, describe, expect, it, vi } from "vitest";

import { VeloConnectionError, VeloError } from "../errors.ts";
import { defaultWebSocketFactory, isNodeRuntime, WebSocketTransport } from "./websocket.ts";
import type { WebSocketConnection, WebSocketRuntime, WebSocketTarget } from "./websocket.ts";

const wsMock = vi.hoisted(() => ({
  calls: [] as { url: string; options: { headers?: Record<string, string> } }[],
  terminated: 0,
}));

vi.mock("ws", () => ({
  default: class MockNodeWebSocket {
    readonly readyState = 0;
    readonly #listeners = new Map<string, ((...args: never[]) => void)[]>();

    constructor(url: string, options: { headers?: Record<string, string> }) {
      wsMock.calls.push({ url, options });
    }

    on(type: string, listener: (...args: never[]) => void): this {
      this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener]);
      return this;
    }

    listenerCount(type: string): number {
      return (this.#listeners.get(type) ?? []).length;
    }

    emit(type: string, ...args: never[]): boolean {
      const listeners = this.#listeners.get(type) ?? [];
      for (const listener of listeners) listener(...args);
      return listeners.length > 0;
    }

    terminate() {
      wsMock.terminated++;
    }

    send() {}
    close() {}
    addEventListener() {}
    removeEventListener() {}
  },
}));

const SOCKET = {
  readyState: 0,
  send() {},
  close() {},
  addEventListener() {},
  removeEventListener() {},
} as WebSocketConnection;

const NODE_RUNTIME: WebSocketRuntime = {
  process: {
    release: { name: "node" },
    versions: { node: "20.3.0" },
  },
};

describe("WebSocket runtime adapters", () => {
  beforeEach(() => {
    wsMock.calls.length = 0;
  });

  it("uses ws with Basic auth on Node", async () => {
    let target: WebSocketTarget | undefined;
    const transport = new WebSocketTransport(
      { apiKey: "test/key", baseUrl: "https://example.test" },
      (value) => {
        target = value;
        return SOCKET;
      },
    );
    await transport.connect();

    const socket = await defaultWebSocketFactory(target as WebSocketTarget, NODE_RUNTIME);
    expect(socket).toBeInstanceOf(Object);
    expect(wsMock.calls).toEqual([
      {
        url: "wss://example.test/api/w/connect",
        options: {
          headers: { authorization: `Basic ${btoa("api:test/key")}` },
        },
      },
    ]);
  });

  it("uses native WebSocket with one encoded key path segment elsewhere", async () => {
    const urls: string[] = [];
    class NativeWebSocket {
      constructor(url: string) {
        urls.push(url);
      }
    }
    const runtime: WebSocketRuntime = { WebSocket: NativeWebSocket };
    let target: WebSocketTarget | undefined;
    const transport = new WebSocketTransport(
      { apiKey: "a/b +?", baseUrl: "http://localhost:3000/" },
      (value) => {
        target = value;
        return SOCKET;
      },
    );
    await transport.connect();

    await defaultWebSocketFactory(target as WebSocketTarget, runtime);
    expect(urls).toEqual(["ws://localhost:3000/api/w/connect/a%2Fb%20%2B%3F"]);
  });

  it("does not mistake Bun, Deno, or a browser process shim for Node", () => {
    expect(isNodeRuntime(NODE_RUNTIME)).toBe(true);
    expect(
      isNodeRuntime({
        ...NODE_RUNTIME,
        process: {
          ...NODE_RUNTIME.process,
          versions: { node: "22.0.0", bun: "1.3.0" },
        },
      }),
    ).toBe(false);
    expect(
      isNodeRuntime({
        ...NODE_RUNTIME,
        process: {
          ...NODE_RUNTIME.process,
          versions: { node: "22.0.0", deno: "2.0.0" },
        },
        Deno: {},
      }),
    ).toBe(false);
    expect(
      isNodeRuntime({
        process: {
          release: { name: "browser" },
          versions: { node: "22.0.0" },
        },
      }),
    ).toBe(false);
  });

  it("fails clearly when neither Node nor a native WebSocket is available", async () => {
    const transport = new WebSocketTransport({ apiKey: "key" }, async (target) =>
      defaultWebSocketFactory(target, {}),
    );

    await expect(transport.connect()).rejects.toThrow(VeloConnectionError);
    await expect(transport.connect()).rejects.toThrow(/unavailable/);
  });

  it("redacts raw, encoded, and Basic-auth forms from connection failures", async () => {
    const apiKey = "a/b +?";
    const alternateEncodedKey = encodeURIComponent(apiKey).replace(/%[0-9A-F]{2}/g, (escape) =>
      escape.toLowerCase(),
    );
    let target: WebSocketTarget | undefined;
    const transport = new WebSocketTransport(
      { apiKey, baseUrl: "https://example.test" },
      (value) => {
        target = value;
        throw new Error(
          `${apiKey} ${value.authenticatedUrl} ${alternateEncodedKey} ${value.headers.authorization as string}`,
        );
      },
    );

    const error = await transport.connect().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(VeloConnectionError);
    const cause = (error as Error).cause as Error;
    const surfaced = [
      (error as Error).message,
      (error as VeloConnectionError).url,
      (error as Error).stack,
      cause.message,
      cause.stack,
    ].join("\n");
    expect(surfaced).toContain("[REDACTED]");
    expect(surfaced).not.toContain(apiKey);
    expect(surfaced).not.toContain(encodeURIComponent(apiKey));
    expect(surfaced).not.toContain(alternateEncodedKey);
    expect(surfaced).not.toContain(btoa(`api:${apiKey}`));
    expect((error as VeloConnectionError).url).toBe("wss://example.test/api/w/connect");
    expect(target).toBeDefined();
  });

  it("rejects base URLs whose protocol cannot be upgraded when streaming starts", async () => {
    const transport = new WebSocketTransport({
      apiKey: "key",
      baseUrl: "ftp://example.test",
    });
    await expect(transport.connect()).rejects.toBeInstanceOf(VeloError);
  });

  it("rejects an unparseable baseUrl with a configuration error, not a socket failure", async () => {
    const transport = new WebSocketTransport({ apiKey: "key", baseUrl: "not a url" });
    const error = await transport.connect().catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(VeloError);
    expect(error).not.toBeInstanceOf(VeloConnectionError);
    expect((error as Error).message).toMatch(/invalid baseUrl/);
  });

  it("surfaces the text of a non-Error connection failure", async () => {
    const transport = new WebSocketTransport(
      { apiKey: "key", baseUrl: "https://example.test" },
      () => {
        throw "handshake refused";
      },
    );
    const error = await transport.connect().catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(VeloConnectionError);
    expect((error as Error).message).toContain("handshake refused");
  });
});
