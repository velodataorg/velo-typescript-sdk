import { VeloConnectionError, VeloError } from "../errors.ts";
import { assert } from "../util/assert.ts";
import { parseBaseUrl } from "./base-url.ts";
import { toError } from "./error-mapping.ts";

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

/* Close codes per RFC 6455: a normal closure, and one the socket never reported. */
export const CLEAN_CLOSE_CODE = 1000;
export const ABNORMAL_CLOSE_CODE = 1006;

/**
 * Builds the close an intentional shutdown reports.
 *
 * @returns A normal-closure event (code 1000).
 */
export function cleanCloseEvent(): WebSocketCloseEvent {
  return { code: CLEAN_CLOSE_CODE, reason: "", wasClean: true };
}

/**
 * Builds the close reported when a connection ends without a close frame.
 *
 * @returns An abnormal-closure event (code 1006).
 */
export function abnormalCloseEvent(): WebSocketCloseEvent {
  return { code: ABNORMAL_CLOSE_CODE, reason: "", wasClean: false };
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
 * A handshake the server answered instead of upgrading.
 *
 * A browser never reports one — the WebSocket API withholds the response —
 * so its absence is not evidence that the server accepted anything.
 */
interface RefusedHandshake extends Error {
  status?: number | undefined;
  headers?: Record<string, string> | undefined;
  body?: string | undefined;
}

function refusedHandshake(cause: unknown): RefusedHandshake | undefined {
  const refused = cause as RefusedHandshake | null | undefined;
  return typeof refused?.status === "number" ? refused : undefined;
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
    const socket = new NodeWebSocket(target.url, { headers: target.headers });

    /* An emitter with nothing listening for `error` throws, which would take
     * the host process down for a failure the caller has already abandoned.
     * Every later listener still receives its events.
     */
    socket.on("error", () => {});

    /* A refused upgrade arrives as its own event carrying the response, and
     * listening for it suppresses the generic error the socket would
     * otherwise emit. Re-raise it with the status attached, so a caller reads
     * the number the server sent instead of parsing a message for it.
     */
    socket.on("unexpected-response", (_request, response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        const refused: RefusedHandshake = new Error(
          `Unexpected server response: ${String(response.statusCode)}`,
        );
        refused.status = response.statusCode;
        refused.headers = Object.fromEntries(
          Object.entries(response.headers).map(([name, value]) => [name, String(value ?? "")]),
        );
        refused.body = Buffer.concat(chunks).toString("utf8");
        socket.emit("error", refused);
        socket.terminate();
      });
      response.resume();
    });

    return socket as unknown as WebSocketConnection;
  }

  const NativeWebSocket = scope.WebSocket;
  if (typeof NativeWebSocket !== "function") {
    throw new VeloConnectionError("WebSocket is unavailable in this runtime", {
      url: target.url,
    });
  }
  return new NativeWebSocket(target.authenticatedUrl) as WebSocketConnection;
}

/**
 * Connection configuration for one socket endpoint. Every `connect()` call
 * creates a fresh socket; the transport never reconnects implicitly.
 */
export class WebSocketTransport {
  readonly #encodedKeyPattern: RegExp | undefined;
  readonly #factory: WebSocketFactory;
  readonly #secrets: readonly string[];
  readonly #target: WebSocketTarget;

  /**
   * @param config - The credential and the HTTP(S) origin sockets upgrade from.
   * @param path - The endpoint path appended to the origin, starting with `/`.
   * @param factory - Creates the runtime socket; the default adapts Node and
   * native runtimes.
   * @throws A VeloError when the API key is missing, the base URL is not an
   * HTTP(S) URL, or the path does not start with `/`.
   */
  constructor(
    config: { readonly apiKey: string; readonly baseUrl?: string },
    path: string,
    factory: WebSocketFactory = defaultWebSocketFactory,
  ) {
    assert(config.apiKey, "apiKey is required");
    assert(typeof path === "string" && path.startsWith("/"), "path must start with /");

    const encodedKey = encodeURIComponent(config.apiKey);
    const authToken = btoa(`api:${config.apiKey}`);
    const url = websocketUrl(parseBaseUrl(config.baseUrl), path);
    this.#encodedKeyPattern = percentEncodedSecretPattern(encodedKey);
    this.#factory = factory;
    this.#secrets = [encodedKey, config.apiKey, authToken]
      .filter((secret, index, all) => secret.length > 0 && all.indexOf(secret) === index)
      .sort((a, b) => b.length - a.length);
    this.#target = Object.freeze({
      url,
      authenticatedUrl: `${url}/${encodedKey}`,
      headers: Object.freeze({ authorization: `Basic ${authToken}` }),
    });
  }

  get url(): string {
    return this.#target.url;
  }

  async connect(): Promise<WebSocketConnection> {
    try {
      return await this.#factory(this.#target);
    } catch (cause) {
      throw this.connectionError("connection failed", cause);
    }
  }

  /**
   * Builds a credential-safe connection failure. The original error is
   * copied rather than retained because factory errors may contain the
   * authenticated browser URL or Authorization header.
   */
  connectionError(message: string, cause?: unknown): VeloError {
    /* A refused upgrade is a non-successful HTTP response, so it maps to the
     * same typed errors a request would raise. Only a connection that never
     * reached a server stays a bare connection failure.
     */
    const refused = refusedHandshake(cause);
    if (refused?.status !== undefined) {
      return toError(
        refused.status,
        this.redact(refused.body ?? ""),
        this.url,
        Object.fromEntries(
          Object.entries(refused.headers ?? {}).map(([name, value]) => [name, this.redact(value)]),
        ),
      );
    }

    const safeMessage = this.redact(message);
    const reason = cause === undefined ? "" : `: ${this.redact(reasonOf(cause))}`;
    const safeCause =
      cause === undefined
        ? undefined
        : new Error(this.redact(reasonOf(cause)), { cause: undefined });
    return new VeloConnectionError(`Velo WebSocket ${safeMessage}${reason}`, {
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
}

/**
 * Builds the socket address a base URL upgrades to.
 *
 * @param baseUrl - A checked HTTP(S) base URL, without trailing slashes.
 * @param path - The endpoint path, starting with `/`.
 * @returns The `wss:` address for an `https:` base URL, and `ws:` for `http:`.
 */
function websocketUrl(baseUrl: string, path: string): string {
  const url = new URL(`${baseUrl}${path}`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
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
