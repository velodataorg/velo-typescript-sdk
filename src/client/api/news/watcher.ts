import { NEWS_WEBSOCKET_PATH } from "../../../constants/endpoints.ts";
import { VeloError } from "../../../errors.ts";
import { MAX_TIMER_MS } from "../../../transport/retry.ts";
import { WebSocketSession } from "../../../transport/session.ts";
import type { WebSocketSessionHandlers } from "../../../transport/session.ts";
import type { WebSocketTransport } from "../../../transport/websocket.ts";
import { assert } from "../../../util/assert.ts";
import { SafeEmitter } from "../../../util/emitter.ts";
import type { WatcherOf, WatchState } from "../../watch/watcher.ts";
import { decodeNewsMessage, frameText } from "./decode.ts";
import type { DecodedNewsMessage } from "./decode.ts";
import type { NewsStory } from "./validation.ts";

const SUBSCRIBE_NEWS = "subscribe news_priority";
const CLEAN_CLOSE_CODE = 1000;
const ABNORMAL_CLOSE_CODE = 1006;

export const DEFAULT_NEWS_HEARTBEAT_TIMEOUT = 5 * 60 * 1000;
export const DEFAULT_NEWS_CONNECT_TIMEOUT = 30 * 1000;

export interface NewsWatchOptions {
  /* Closes the watcher when aborted. */
  readonly signal?: AbortSignal;
  /* Maximum milliseconds between application heartbeat messages. */
  readonly heartbeatTimeout?: number;
  /* Maximum milliseconds for connect() to reach an open subscription. */
  readonly connectTimeout?: number;
  /**
   * Replaces the default reporting for event-listener failures.
   *
   * Receives every error thrown — or promise rejection returned — by a
   * listener. Without it, failures go to `reportError` where the runtime
   * provides it and `console.error` otherwise. Should not throw or reject;
   * if it does, both errors fall back to the default reporting.
   */
  readonly onListenerError?: (error: unknown) => unknown;
}

export type NewsWatcherState = WatchState;

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

/**
 * A live News subscription.
 *
 * The shared watcher contract over the News event map — the lifecycle is
 * identical for every kind, so it is declared once rather than restated here.
 */
export type NewsWatcher = WatcherOf<NewsWatcherEvents>;

interface PreparedNewsWatchOptions {
  readonly signal: AbortSignal | undefined;
  readonly heartbeatTimeout: number;
  readonly connectTimeout: number;
  readonly onListenerError: ((error: unknown) => unknown) | undefined;
}

/**
 * A disconnected controller for the live News WebSocket.
 *
 * The controller itself never reconnects on its own — it reports an
 * unexpected loss by entering `disconnected` and emitting `close`, and
 * `connect()` reopens it. Resuming automatically is the watch layer's job,
 * so every subscription kind gets it from one place.
 *
 * Nothing published while disconnected is replayed: `begin` filters news on
 * publication time, so a reconnect recovers new stories only, never edits or
 * deletions applied to older ones.
 */
export class NewsWatcherController implements NewsWatcher {
  readonly #connectTimeout: number;
  readonly #emitter: SafeEmitter<NewsWatcherEvents>;
  readonly #heartbeatTimeout: number;
  readonly #signal: AbortSignal | undefined;
  readonly #transport: WebSocketTransport;

  #attempt: AbortController | undefined;
  #connectPromise: Promise<void> | undefined;
  #heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  #listeningForAbort = false;
  #pendingFrames: unknown[] = [];
  #rejectConnect: ((reason?: unknown) => void) | undefined;
  #resolveConnect: (() => void) | undefined;
  #session: WebSocketSession | undefined;
  #state: NewsWatcherState = "idle";

  constructor(transport: WebSocketTransport, options: NewsWatchOptions = {}) {
    const prepared = prepareNewsWatchOptions(options);
    this.#transport = transport;
    this.#signal = prepared.signal;
    this.#heartbeatTimeout = prepared.heartbeatTimeout;
    this.#connectTimeout = prepared.connectTimeout;
    this.#emitter = new SafeEmitter(prepared.onListenerError);
  }

  get state(): NewsWatcherState {
    return this.#state;
  }

  on<K extends keyof NewsWatcherEvents>(type: K, listener: NewsWatcherListener<K>): this {
    this.#emitter.on(type, listener);
    return this;
  }

  off<K extends keyof NewsWatcherEvents>(type: K, listener: NewsWatcherListener<K>): this {
    this.#emitter.off(type, listener);
    return this;
  }

  connect(): Promise<void> {
    if (this.#state === "connecting" || this.#state === "open") {
      return this.#connectPromise as Promise<void>;
    }
    if (this.#state === "closed") {
      return Promise.reject(new VeloError("News watcher is closed"));
    }

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

    const attempt = new AbortController();
    this.#attempt = attempt;
    void WebSocketSession.open(this.#transport, this.#sessionHandlers(attempt), {
      timeout: this.#connectTimeout,
      signal: attempt.signal,
    }).then(
      (session) => {
        this.#subscribe(attempt, session);
      },
      (cause: unknown) => {
        if (this.#attempt !== attempt || this.#state !== "connecting") return;
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

  /**
   * Builds the session callbacks for one connection attempt.
   *
   * @remarks
   * Each callback ignores events once `attempt` is no longer current, so a
   * session outliving its attempt — however briefly — cannot corrupt a
   * newer connection's state.
   *
   * @param attempt - The attempt the returned handlers belong to.
   * @returns Handlers wired to this watcher.
   */
  #sessionHandlers(attempt: AbortController): WebSocketSessionHandlers {
    return {
      onMessage: (data) => {
        if (this.#attempt !== attempt) return;
        if (this.#state === "connecting") {
          this.#pendingFrames.push(data);
          return;
        }
        this.#handleMessage(data);
      },
      onClose: (close, error) => {
        if (this.#attempt !== attempt) return;
        this.#fail(error, close);
      },
    };
  }

  /**
   * Subscribes on a freshly opened session and settles `connect()`.
   *
   * @param attempt - The attempt that opened `session`.
   * @param session - The open session to subscribe on.
   */
  #subscribe(attempt: AbortController, session: WebSocketSession): void {
    if (this.#attempt !== attempt || this.#state !== "connecting") {
      session.close();
      return;
    }
    this.#session = session;

    try {
      session.send(SUBSCRIBE_NEWS);
    } catch (cause) {
      this.#fail(this.#transport.connectionError("subscription failed", cause), abnormalClose());
      return;
    }

    // A custom socket may emit a terminal event synchronously from send().
    // Do not revive a connection that #fail() already made terminal.
    if (this.#state !== "connecting" || this.#session !== session) return;

    this.#state = "open";
    this.#resetHeartbeat();
    const resolve = this.#resolveConnect;
    this.#resolveConnect = undefined;
    this.#rejectConnect = undefined;
    resolve?.();
    this.#drainPendingFrames();
  }

  /**
   * Replays frames received between session attachment and subscription.
   *
   * @remarks
   * A frame can fail or synchronously disconnect the watcher through a
   * listener, so stop as soon as the watcher is no longer open. Taking the
   * current array before dispatch also keeps a newer attempt's queue isolated
   * if a listener reconnects during the drain.
   */
  #drainPendingFrames(): void {
    const pending = this.#pendingFrames;
    this.#pendingFrames = [];
    for (const frame of pending) {
      if (this.#state !== "open") break;
      this.#handleMessage(frame);
    }
  }

  /**
   * Decodes one frame and emits its domain event.
   *
   * @param data - The frame's raw data from the session.
   */
  #handleMessage(data: unknown): void {
    if (this.#state !== "open") return;

    let message: DecodedNewsMessage;
    try {
      message = decodeNewsMessage(frameText(data));
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
      this.#emitter.emit("delete", { id: message.id });
    } else {
      this.#emitter.emit(message.type, message.story);
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
    this.#teardown();
    reject?.(error);

    if (emitError) this.#emitter.emit("error", error);
    this.#emitter.emit("close", close);
  }

  #disconnect(reason: unknown): void {
    const reject = this.#rejectConnect;
    this.#state = "idle";
    this.#connectPromise = undefined;
    this.#resolveConnect = undefined;
    this.#rejectConnect = undefined;
    this.#teardown();
    reject?.(reason);

    this.#emitter.emit("close", cleanClose());
  }

  #cancel(reason: unknown): void {
    if (this.#state === "closed") return;

    const reject = this.#rejectConnect;
    this.#state = "closed";
    this.#connectPromise = undefined;
    this.#resolveConnect = undefined;
    this.#rejectConnect = undefined;
    this.#teardown();
    this.#stopListeningForAbort();
    reject?.(reason);

    this.#emitter.emit("close", cleanClose());
    this.#emitter.clear();
  }

  /**
   * Releases the connection resources: the heartbeat timer, a pending
   * attempt, and the current session.
   */
  #teardown(): void {
    if (this.#heartbeatTimer !== undefined) {
      clearTimeout(this.#heartbeatTimer);
      this.#heartbeatTimer = undefined;
    }
    this.#pendingFrames = [];

    const attempt = this.#attempt;
    this.#attempt = undefined;
    attempt?.abort();

    const session = this.#session;
    this.#session = undefined;
    session?.close();
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
}

export function prepareNewsWatchOptions(options: NewsWatchOptions): PreparedNewsWatchOptions {
  assert(
    options !== null && typeof options === "object" && !Array.isArray(options),
    "news watch options must be an object",
  );

  const { signal, onListenerError } = options;
  assert(signal === undefined || isAbortSignal(signal), "signal must be an AbortSignal");
  assert(
    onListenerError === undefined || typeof onListenerError === "function",
    "onListenerError must be a function",
  );

  const heartbeatTimeout = options.heartbeatTimeout ?? DEFAULT_NEWS_HEARTBEAT_TIMEOUT;
  assert(
    Number.isSafeInteger(heartbeatTimeout) &&
      heartbeatTimeout > 0 &&
      heartbeatTimeout <= MAX_TIMER_MS,
    () =>
      `heartbeatTimeout must be a positive integer of at most ${MAX_TIMER_MS} milliseconds (got ${String(heartbeatTimeout)})`,
  );

  const connectTimeout = options.connectTimeout ?? DEFAULT_NEWS_CONNECT_TIMEOUT;
  assert(
    Number.isSafeInteger(connectTimeout) && connectTimeout > 0 && connectTimeout <= MAX_TIMER_MS,
    () =>
      `connectTimeout must be a positive integer of at most ${MAX_TIMER_MS} milliseconds (got ${String(connectTimeout)})`,
  );

  return { signal, heartbeatTimeout, connectTimeout, onListenerError };
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
