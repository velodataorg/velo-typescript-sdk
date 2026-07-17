import { BASE_URL, NEWS_WEBSOCKET_PATH } from "../constants.js";
import { VeloConnectionError, VeloError } from "../errors.js";
import { assert } from "../util/assert.js";

export interface WebSocketMessageEvent {
  readonly data: unknown;
}

export interface WebSocketErrorEvent {
  readonly error?: unknown;
  readonly message?: string;
}

export interface WebSocketCloseEvent {
  readonly code: number;
  readonly reason: string;
  readonly wasClean: boolean;
}

export interface WebSocketEvents {
  readonly open: object;
  readonly message: WebSocketMessageEvent;
  readonly error: WebSocketErrorEvent;
  readonly close: WebSocketCloseEvent;
}

/**
 * The small WebSocket surface the SDK uses. Both native WebSocket and `ws`
 * are adapted to this boundary so neither implementation leaks publicly.
 */
export interface WebSocketConnection {
  readonly readyState: number;

  send(data: string): void;
  close(code?: number, reason?: string): void;

  addEventListener<K extends keyof WebSocketEvents>(
    type: K,
    listener: (event: WebSocketEvents[K]) => void,
  ): void;
  removeEventListener<K extends keyof WebSocketEvents>(
    type: K,
    listener: (event: WebSocketEvents[K]) => void,
  ): void;
}

/**
 * Authenticated connection inputs for a custom WebSocket factory.
 *
 * `url` plus `headers` is intended for clients that support handshake
 * headers. `authenticatedUrl` is the documented fallback for native browser
 * WebSockets, which cannot set an Authorization header.
 */
export interface WebSocketTarget {
  readonly url: string;
  readonly authenticatedUrl: string;
  readonly headers: Readonly<Record<string, string>>;
}

export type WebSocketFactory = (
  target: WebSocketTarget,
) => WebSocketConnection | Promise<WebSocketConnection>;

export interface WebSocketRuntime {
  readonly process?: {
    readonly release?: { readonly name?: string };
    readonly versions?: Readonly<Record<string, string | undefined>>;
  };
  readonly Deno?: unknown;
  readonly WebSocket?: new (url: string) => unknown;
}

const REDACTED = "[REDACTED]";

/**
 * Distinguishes real Node from Bun, Deno, workers, and browser process shims.
 * Node uses `ws` for Basic-auth headers; the others use their native socket.
 */
export function isNodeRuntime(scope: WebSocketRuntime): boolean {
  const { process } = scope;
  const versions = process?.versions;
  return (
    process?.release?.name === "node" &&
    typeof versions?.node === "string" &&
    typeof versions.bun !== "string" &&
    typeof versions.deno !== "string" &&
    !("Deno" in scope)
  );
}

/**
 * Creates a socket using `ws` on Node and the native constructor everywhere
 * else. The Node dependency remains behind a dynamic import so browser
 * runtimes never execute it.
 */
export async function defaultWebSocketFactory(
  target: WebSocketTarget,
  scope: WebSocketRuntime = globalThis as unknown as WebSocketRuntime,
): Promise<WebSocketConnection> {
  if (isNodeRuntime(scope)) {
    const { default: NodeWebSocket } = await import("ws");
    return new NodeWebSocket(target.url, {
      headers: target.headers,
    }) as unknown as WebSocketConnection;
  }

  const NativeWebSocket = scope.WebSocket;
  if (typeof NativeWebSocket !== "function") {
    throw new VeloConnectionError("WebSocket is unavailable in this runtime");
  }
  return new NativeWebSocket(target.authenticatedUrl) as WebSocketConnection;
}

/**
 * Shared WebSocket connection configuration. Every `connect()` call creates
 * a fresh socket; the transport never reconnects implicitly.
 */
export class WebSocketTransport {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #encodedKeyPattern: RegExp | undefined;
  readonly #factory: WebSocketFactory;
  readonly #secrets: readonly string[];
  #target: WebSocketTarget | undefined;

  constructor(
    config: { readonly apiKey: string; readonly baseUrl?: string },
    factory: WebSocketFactory = defaultWebSocketFactory,
  ) {
    assert(config.apiKey, "apiKey is required");

    const encodedKey = encodeURIComponent(config.apiKey);
    const authToken = btoa(`api:${config.apiKey}`);
    this.#apiKey = config.apiKey;
    this.#baseUrl = config.baseUrl ?? BASE_URL;
    this.#encodedKeyPattern = percentEncodedSecretPattern(encodedKey);
    this.#factory = factory;
    this.#secrets = [encodedKey, config.apiKey, authToken]
      .filter((secret, index, all) => secret.length > 0 && all.indexOf(secret) === index)
      .sort((a, b) => b.length - a.length);
  }

  get url(): string {
    return this.#target?.url ?? NEWS_WEBSOCKET_PATH;
  }

  async connect(): Promise<WebSocketConnection> {
    let target: WebSocketTarget;
    try {
      target = this.#connectionTarget();
    } catch (cause) {
      // Target construction contains no API key and has its own useful
      // configuration error, so do not obscure it as a socket failure.
      if (cause instanceof VeloError) throw cause;
      throw this.connectionError("connection failed", cause);
    }

    try {
      return await this.#factory(target);
    } catch (cause) {
      throw this.connectionError("connection failed", cause);
    }
  }

  /**
   * Builds a credential-safe connection failure. The original error is
   * copied rather than retained because factory errors may contain the
   * authenticated browser URL or Authorization header.
   */
  connectionError(message: string, cause?: unknown): VeloConnectionError {
    const safeMessage = this.redact(message);
    const reason = cause === undefined ? "" : `: ${this.redact(reasonOf(cause))}`;
    const safeCause =
      cause === undefined
        ? undefined
        : new Error(this.redact(reasonOf(cause)), { cause: undefined });
    return new VeloConnectionError(`Velo News WebSocket ${safeMessage}${reason}`, {
      url: this.url,
      cause: safeCause,
    });
  }

  redact(value: string): string {
    let safe = value;
    for (const secret of this.#secrets) {
      safe = safe.split(secret).join(REDACTED);
    }
    if (this.#encodedKeyPattern) {
      safe = safe.replace(this.#encodedKeyPattern, REDACTED);
    }
    return safe;
  }

  #connectionTarget(): WebSocketTarget {
    if (this.#target) return this.#target;

    const url = websocketUrl(this.#baseUrl);
    const encodedKey = encodeURIComponent(this.#apiKey);
    const authToken = btoa(`api:${this.#apiKey}`);
    this.#target = Object.freeze({
      url,
      authenticatedUrl: `${url}/${encodedKey}`,
      headers: Object.freeze({ authorization: `Basic ${authToken}` }),
    });
    return this.#target;
  }
}

function websocketUrl(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(`${baseUrl.replace(/\/+$/, "")}${NEWS_WEBSOCKET_PATH}`);
  } catch (cause) {
    throw new VeloError(`invalid baseUrl ${baseUrl}`, { cause });
  }

  if (url.protocol === "https:") {
    url.protocol = "wss:";
  } else if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else {
    throw new VeloError(`invalid baseUrl protocol ${url.protocol}`);
  }
  return url.toString();
}

function reasonOf(value: unknown): string {
  if (value instanceof Error) return value.message;
  return String(value);
}

function percentEncodedSecretPattern(secret: string): RegExp | undefined {
  let hasHexLetter = false;
  const source = escapeRegExp(secret).replace(/%([0-9A-F]{2})/g, (_match, hex: string) => {
    const bytes = Array.from(hex, (character) => {
      if (character < "A" || character > "F") return character;
      hasHexLetter = true;
      return `[${character}${character.toLowerCase()}]`;
    });
    return `%${bytes.join("")}`;
  });
  return hasHexLetter ? new RegExp(source, "g") : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
