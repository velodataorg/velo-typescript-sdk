import { z } from "zod";

import { NEWS_WEBSOCKET_PATH } from "../../constants.js";
import { VeloError } from "../../errors.js";
import { MAX_TIMER_MS } from "../../transport/retry.js";
import type {
  WebSocketCloseEvent,
  WebSocketConnection,
  WebSocketErrorEvent,
  WebSocketEvents,
  WebSocketMessageEvent,
  WebSocketTransport,
} from "../../transport/websocket.js";
import { assert } from "../../util/assert.js";
import { NewsStorySchema } from "./schema.js";
import type { NewsStory } from "./schema.js";

const SUBSCRIBE_NEWS = "subscribe news_priority";
const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLEAN_CLOSE_CODE = 1000;
const ABNORMAL_CLOSE_CODE = 1006;

export const DEFAULT_NEWS_HEARTBEAT_TIMEOUT = 5 * 60 * 1000;

const MessageObjectSchema = z.record(z.string(), z.unknown());
const HeartbeatSchema = z.strictObject({ heartbeat: z.literal(true) });
const DeleteSchema = z.strictObject({
  id: z.int(),
  deleted: z.literal(true),
});
const EditSchema = NewsStorySchema.extend({
  edit: z.literal(true),
});

export interface NewsWatchOptions {
  /* Closes the watcher when aborted. */
  readonly signal?: AbortSignal;
  /* Maximum milliseconds between application heartbeat messages. */
  readonly heartbeatTimeout?: number;
}

export type NewsWatcherState = "idle" | "connecting" | "open" | "disconnected" | "closed";

export interface NewsDelete {
  readonly id: number;
}

export interface NewsClose {
  readonly code: number;
  readonly reason: string;
  readonly wasClean: boolean;
}

export interface NewsWatcherEvents {
  readonly story: NewsStory;
  readonly edit: NewsStory;
  readonly delete: NewsDelete;
  readonly error: VeloError;
  readonly close: NewsClose;
}

export type NewsWatcherListener<K extends keyof NewsWatcherEvents> = (
  event: NewsWatcherEvents[K],
) => void;

export interface NewsWatcher {
  readonly state: NewsWatcherState;

  /**
   * Adds a listener for one decoded News or watcher-lifecycle event.
   *
   * Adding the same listener more than once has no additional effect.
   */
  on<K extends keyof NewsWatcherEvents>(type: K, listener: NewsWatcherListener<K>): this;

  /* Removes a previously registered listener. */
  off<K extends keyof NewsWatcherEvents>(type: K, listener: NewsWatcherListener<K>): this;

  /**
   * Opens a socket and subscribes to live News.
   *
   * Concurrent calls share one connection attempt. After an unexpected
   * connection loss, call `connect()` again to reconnect this watcher.
   */
  connect(): Promise<void>;

  /**
   * Intentionally closes the current connection while keeping this watcher
   * and its listeners reusable.
   */
  disconnect(): void;

  /* Permanently closes this watcher. Safe to call more than once. */
  close(): void;
}

type DecodedNewsMessage =
  | { readonly type: "heartbeat" }
  | { readonly type: "story"; readonly story: NewsStory }
  | { readonly type: "edit"; readonly story: NewsStory }
  | { readonly type: "delete"; readonly id: number };

interface PreparedNewsWatchOptions {
  readonly signal: AbortSignal | undefined;
  readonly heartbeatTimeout: number;
}

type UntypedListener = (event: unknown) => unknown;

const TEXT_DECODER = new TextDecoder();
const IGNORE_SOCKET_ERROR = (): void => {};

/**
 * A disconnected controller for the live News WebSocket.
 *
 * Reconnection is always explicit: without a server cursor, automatically
 * reconnecting could conceal stories, edits, or deletions missed while offline.
 */
export class NewsWatcherController implements NewsWatcher {
  readonly #heartbeatTimeout: number;
  readonly #signal: AbortSignal | undefined;
  readonly #transport: WebSocketTransport;
  readonly #listeners: Record<keyof NewsWatcherEvents, Set<UntypedListener>> = {
    story: new Set(),
    edit: new Set(),
    delete: new Set(),
    error: new Set(),
    close: new Set(),
  };

  #connectPromise: Promise<void> | undefined;
  #connectionAttempt = 0;
  #heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  #listeningForAbort = false;
  #rejectConnect: ((reason?: unknown) => void) | undefined;
  #resolveConnect: (() => void) | undefined;
  #socket: WebSocketConnection | undefined;
  #state: NewsWatcherState = "idle";
  #subscribed = false;

  constructor(transport: WebSocketTransport, options: NewsWatchOptions = {}) {
    const prepared = prepareNewsWatchOptions(options);
    this.#transport = transport;
    this.#signal = prepared.signal;
    this.#heartbeatTimeout = prepared.heartbeatTimeout;
  }

  get state(): NewsWatcherState {
    return this.#state;
  }

  on<K extends keyof NewsWatcherEvents>(type: K, listener: NewsWatcherListener<K>): this {
    this.#listeners[type].add(listener as unknown as UntypedListener);
    return this;
  }

  off<K extends keyof NewsWatcherEvents>(type: K, listener: NewsWatcherListener<K>): this {
    this.#listeners[type].delete(listener as unknown as UntypedListener);
    return this;
  }

  connect(): Promise<void> {
    if (this.#state === "connecting" || this.#state === "open") {
      return this.#connectPromise as Promise<void>;
    }
    if (this.#state === "closed") {
      return Promise.reject(new VeloError("News watcher is closed"));
    }

    this.#subscribed = false;
    this.#state = "connecting";
    const connectPromise = new Promise<void>((resolve, reject) => {
      this.#resolveConnect = resolve;
      this.#rejectConnect = reject;
    });
    this.#connectPromise = connectPromise;

    if (this.#signal?.aborted) {
      this.#cancel(abortReason(this.#signal));
      return connectPromise;
    }
    this.#listenForAbort();

    const attempt = ++this.#connectionAttempt;
    void this.#transport.connect().then(
      (socket) => {
        if (this.#state !== "connecting" || this.#connectionAttempt !== attempt) {
          closeSocket(socket);
          return;
        }
        try {
          this.#attach(socket);
        } catch (cause) {
          this.#fail(
            this.#transport.connectionError("connection setup failed", cause),
            abnormalClose(),
          );
        }
      },
      (cause: unknown) => {
        if (this.#state !== "connecting" || this.#connectionAttempt !== attempt) return;
        const error =
          cause instanceof VeloError
            ? cause
            : this.#transport.connectionError("connection failed", cause);
        this.#fail(error, abnormalClose());
      },
    );

    return connectPromise;
  }

  disconnect(): void {
    if (this.#state === "closed" || this.#state === "idle") return;
    if (this.#state === "disconnected") {
      this.#state = "idle";
      return;
    }
    this.#disconnect(new DOMException("The News watcher was disconnected.", "AbortError"));
  }

  close(): void {
    if (this.#state === "closed") return;
    this.#cancel(new DOMException("The News watcher was closed.", "AbortError"));
  }

  readonly #onAbort = (): void => {
    const signal = this.#signal as AbortSignal;
    this.#cancel(abortReason(signal));
  };

  readonly #onOpen = (): void => {
    if (this.#state !== "connecting" || this.#subscribed) return;
    const socket = this.#socket;
    if (!socket) {
      this.#fail(
        this.#transport.connectionError("subscription failed: missing socket"),
        abnormalClose(),
      );
      return;
    }
    this.#subscribed = true;

    try {
      socket.send(SUBSCRIBE_NEWS);
    } catch (cause) {
      this.#fail(this.#transport.connectionError("subscription failed", cause), abnormalClose());
      return;
    }

    // A custom socket may synchronously emit `error` or `close` from send().
    // Do not revive a connection that #fail() already made terminal.
    if (this.#state !== "connecting" || this.#socket !== socket || !this.#subscribed) return;

    this.#state = "open";
    this.#resetHeartbeat();
    const resolve = this.#resolveConnect;
    this.#resolveConnect = undefined;
    this.#rejectConnect = undefined;
    resolve?.();
  };

  readonly #onMessage = (event: WebSocketMessageEvent): void => {
    if (this.#state !== "open") return;

    let message: DecodedNewsMessage;
    try {
      message = decodeNewsMessage(frameText(event.data));
    } catch (cause) {
      const error =
        cause instanceof VeloError
          ? cause
          : new VeloError(`unexpected ${NEWS_WEBSOCKET_PATH} message`, { cause });
      this.#fail(error, abnormalClose());
      return;
    }

    if (message.type === "heartbeat") {
      this.#resetHeartbeat();
    } else if (message.type === "delete") {
      this.#emit("delete", { id: message.id });
    } else {
      this.#emit(message.type, message.story);
    }
  };

  readonly #onError = (event: WebSocketErrorEvent): void => {
    if (this.#state === "closed") return;
    const cause = event.error ?? event.message ?? "unknown socket error";
    this.#fail(this.#transport.connectionError("connection failed", cause), abnormalClose());
  };

  readonly #onClose = (event: WebSocketCloseEvent): void => {
    if (this.#state === "closed") return;
    const close = {
      code: event.code,
      reason: this.#transport.redact(event.reason),
      wasClean: event.wasClean,
    };
    const detail = event.reason
      ? `closed unexpectedly (code ${event.code}: ${event.reason})`
      : `closed unexpectedly (code ${event.code})`;
    this.#fail(this.#transport.connectionError(detail), close);
  };

  #attach(socket: WebSocketConnection): void {
    this.#socket = socket;
    socket.addEventListener("open", this.#onOpen);
    socket.addEventListener("message", this.#onMessage);
    socket.addEventListener("error", this.#onError);
    socket.addEventListener("close", this.#onClose);

    if (socket.readyState === OPEN) {
      this.#onOpen();
    } else if (socket.readyState >= CLOSING) {
      this.#fail(this.#transport.connectionError("closed before opening"), abnormalClose());
    } else if (socket.readyState !== CONNECTING) {
      this.#fail(
        this.#transport.connectionError(`has invalid readyState ${String(socket.readyState)}`),
        abnormalClose(),
      );
    }
  }

  #resetHeartbeat(): void {
    if (this.#state !== "open") return;
    if (this.#heartbeatTimer !== undefined) clearTimeout(this.#heartbeatTimer);
    this.#heartbeatTimer = setTimeout(() => {
      this.#fail(
        this.#transport.connectionError(
          `heartbeat timed out after ${this.#heartbeatTimeout} milliseconds`,
        ),
        abnormalClose(),
      );
    }, this.#heartbeatTimeout);
  }

  #fail(error: VeloError, close: NewsClose): void {
    if (this.#state !== "connecting" && this.#state !== "open") return;
    const emitError = this.#state === "open";

    const reject = this.#rejectConnect;
    this.#state = "disconnected";
    this.#connectPromise = undefined;
    this.#resolveConnect = undefined;
    this.#rejectConnect = undefined;
    this.#cleanup(true);
    reject?.(error);

    if (emitError) this.#emit("error", error);
    this.#emit("close", close);
  }

  #disconnect(reason: unknown): void {
    const reject = this.#rejectConnect;
    this.#state = "idle";
    this.#connectPromise = undefined;
    this.#resolveConnect = undefined;
    this.#rejectConnect = undefined;
    this.#cleanup(true);
    reject?.(reason);

    this.#emit("close", cleanClose());
  }

  #cancel(reason: unknown): void {
    if (this.#state === "closed") return;

    const reject = this.#rejectConnect;
    this.#state = "closed";
    this.#connectPromise = undefined;
    this.#resolveConnect = undefined;
    this.#rejectConnect = undefined;
    this.#cleanup(true);
    this.#stopListeningForAbort();
    reject?.(reason);

    this.#emit("close", cleanClose());
    this.#clearListeners();
  }

  #cleanup(close: boolean): void {
    if (this.#heartbeatTimer !== undefined) {
      clearTimeout(this.#heartbeatTimer);
      this.#heartbeatTimer = undefined;
    }
    this.#subscribed = false;

    const socket = this.#socket;
    this.#socket = undefined;
    if (!socket) return;

    removeSocketListener(socket, "open", this.#onOpen);
    removeSocketListener(socket, "message", this.#onMessage);
    removeSocketListener(socket, "error", this.#onError);
    removeSocketListener(socket, "close", this.#onClose);
    if (close) closeSocket(socket);
  }

  #listenForAbort(): void {
    if (this.#signal === undefined || this.#listeningForAbort) return;
    this.#signal.addEventListener("abort", this.#onAbort, { once: true });
    this.#listeningForAbort = true;
  }

  #stopListeningForAbort(): void {
    if (this.#signal === undefined || !this.#listeningForAbort) return;
    try {
      this.#signal.removeEventListener("abort", this.#onAbort);
    } catch {
      // Cleanup cannot change the watcher's terminal state.
    }
    this.#listeningForAbort = false;
  }

  #emit<K extends keyof NewsWatcherEvents>(type: K, event: NewsWatcherEvents[K]): void {
    for (const listener of Array.from(this.#listeners[type])) {
      try {
        const result = listener(event);
        if (isPromiseLike(result)) void Promise.resolve(result).catch(reportListenerError);
      } catch (cause) {
        reportListenerError(cause);
      }
    }
  }

  #clearListeners(): void {
    for (const listeners of Object.values(this.#listeners)) listeners.clear();
  }
}

export function prepareNewsWatchOptions(options: NewsWatchOptions): PreparedNewsWatchOptions {
  assert(
    options !== null && typeof options === "object" && !Array.isArray(options),
    "news watch options must be an object",
  );

  const { signal } = options;
  assert(signal === undefined || isAbortSignal(signal), "signal must be an AbortSignal");

  const heartbeatTimeout = options.heartbeatTimeout ?? DEFAULT_NEWS_HEARTBEAT_TIMEOUT;
  assert(
    Number.isSafeInteger(heartbeatTimeout) &&
      heartbeatTimeout > 0 &&
      heartbeatTimeout <= MAX_TIMER_MS,
    () =>
      `heartbeatTimeout must be a positive integer of at most ${MAX_TIMER_MS} milliseconds (got ${String(heartbeatTimeout)})`,
  );
  return { signal, heartbeatTimeout };
}

export function decodeNewsMessage(text: string): DecodedNewsMessage {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (cause) {
    throw new VeloError(`unexpected ${NEWS_WEBSOCKET_PATH} message: invalid JSON`, { cause });
  }

  const object = MessageObjectSchema.safeParse(value);
  if (!object.success) throw unexpectedMessage(object.error);

  const markerNames = (["heartbeat", "deleted", "edit"] as const).filter((name) =>
    Object.hasOwn(object.data, name),
  );
  if (markerNames.length > 1) {
    throw unexpectedMessage(
      new z.ZodError([
        {
          code: "custom",
          path: [],
          message: `conflicting event markers: ${markerNames.join(", ")}`,
        },
      ]),
    );
  }

  const marker = markerNames[0];
  if (marker === "heartbeat") {
    const result = HeartbeatSchema.safeParse(value);
    if (!result.success) throw unexpectedMessage(result.error);
    return { type: "heartbeat" };
  }
  if (marker === "deleted") {
    const result = DeleteSchema.safeParse(value);
    if (!result.success) throw unexpectedMessage(result.error);
    return { type: "delete", id: result.data.id };
  }
  if (marker === "edit") {
    const result = EditSchema.safeParse(value);
    if (!result.success) throw unexpectedMessage(result.error);
    return { type: "edit", story: NewsStorySchema.parse(result.data) };
  }

  const result = NewsStorySchema.safeParse(value);
  if (!result.success) throw unexpectedMessage(result.error);
  return { type: "story", story: result.data };
}

function unexpectedMessage(error: z.ZodError): VeloError {
  return new VeloError(`unexpected ${NEWS_WEBSOCKET_PATH} message:\n${z.prettifyError(error)}`, {
    cause: error,
  });
}

function frameText(data: unknown): string {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return TEXT_DECODER.decode(data);
  if (ArrayBuffer.isView(data)) {
    return TEXT_DECODER.decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }
  throw new VeloError(
    `unexpected ${NEWS_WEBSOCKET_PATH} message data: expected text, got ${Object.prototype.toString.call(data)}`,
  );
}

function closeSocket(socket: WebSocketConnection): void {
  // `ws.close()` while CONNECTING schedules an asynchronous `error`. Keep a
  // sink installed after the watcher's listeners are detached so explicit
  // shutdown cannot become an uncaught EventEmitter error in Node.
  try {
    socket.addEventListener("error", IGNORE_SOCKET_ERROR);
  } catch {
    // A malformed custom socket will still be handled by the close guard.
  }
  try {
    if (socket.readyState >= CLOSING) return;
  } catch {
    // Still attempt close when a custom readyState getter fails.
  }
  try {
    socket.close();
  } catch {
    // The watcher is already terminal; cleanup errors cannot change its state.
  }
}

function removeSocketListener<K extends keyof WebSocketEvents>(
  socket: WebSocketConnection,
  type: K,
  listener: (event: WebSocketEvents[K]) => void,
): void {
  try {
    socket.removeEventListener(type, listener);
  } catch {
    // The watcher is already terminal; cleanup errors cannot change its state.
  }
}

function cleanClose(): NewsClose {
  return { code: CLEAN_CLOSE_CODE, reason: "", wasClean: true };
}

function abnormalClose(): NewsClose {
  return { code: ABNORMAL_CLOSE_CODE, reason: "", wasClean: false };
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

function isAbortSignal(value: unknown): value is AbortSignal {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<AbortSignal>;
  return (
    typeof candidate.aborted === "boolean" &&
    typeof candidate.addEventListener === "function" &&
    typeof candidate.removeEventListener === "function"
  );
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    ((typeof value === "object" && value !== null) || typeof value === "function") &&
    typeof (value as { readonly then?: unknown }).then === "function"
  );
}

function reportListenerError(error: unknown): void {
  const report = (globalThis as typeof globalThis & { reportError?: (cause: unknown) => void })
    .reportError;
  if (typeof report === "function") {
    report(error);
  } else {
    queueMicrotask(() => {
      throw error;
    });
  }
}
