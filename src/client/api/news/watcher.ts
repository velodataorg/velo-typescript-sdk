import { NEWS_WEBSOCKET_PATH } from "../../../constants/endpoints.ts";
import { VeloError } from "../../../errors.ts";
import { frameText } from "../../../transport/frame.ts";
import { WebSocketSession } from "../../../transport/session.ts";
import type { WebSocketSessionHandlers } from "../../../transport/session.ts";
import { abnormalCloseEvent, cleanCloseEvent } from "../../../transport/websocket.ts";
import type { WebSocketCloseEvent, WebSocketTransport } from "../../../transport/websocket.ts";
import { abortReason } from "../../../util/abort.ts";
import { SafeEmitter } from "../../../util/emitter.ts";
import { HeartbeatDeadline } from "../../watch/heartbeat.ts";
import {
  DEFAULT_WATCH_CONNECT_TIMEOUT,
  DEFAULT_WATCH_HEARTBEAT_TIMEOUT,
  prepareWatcherOptions,
} from "../../watch/options.ts";
import type { WatcherOptions } from "../../watch/options.ts";
import type { WatcherOf, WatchState } from "../../watch/watcher.ts";
import { decodeNewsMessage } from "./decode.ts";
import type { DecodedNewsMessage } from "./decode.ts";
import type { NewsStory } from "./validation.ts";

const SUBSCRIBE_NEWS = "subscribe news_priority";

/* The shared watcher defaults, under the names 0.1 published them as. */
export const DEFAULT_NEWS_HEARTBEAT_TIMEOUT = DEFAULT_WATCH_HEARTBEAT_TIMEOUT;
export const DEFAULT_NEWS_CONNECT_TIMEOUT = DEFAULT_WATCH_CONNECT_TIMEOUT;

/** Options for the news feed: the contract every watcher shares. */
export type NewsWatchOptions = WatcherOptions;

export type NewsWatcherState = WatchState;

export interface NewsDelete {
  readonly id: number;
}

/** The close event a news watcher emits: the transport's, unchanged. */
export type NewsClose = WebSocketCloseEvent;

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
  readonly #heartbeat: HeartbeatDeadline;
  readonly #signal: AbortSignal | undefined;
  readonly #transport: WebSocketTransport;

  #attempt: AbortController | undefined;
  #connectPromise: Promise<void> | undefined;
  #listeningForAbort = false;
  #rejectConnect: ((reason?: unknown) => void) | undefined;
  #resolveConnect: (() => void) | undefined;
  #session: WebSocketSession | undefined;
  #state: NewsWatcherState = "idle";

  constructor(transport: WebSocketTransport, options?: NewsWatchOptions) {
    const prepared = prepareWatcherOptions(options);
    this.#transport = transport;
    this.#signal = prepared.signal;
    this.#connectTimeout = prepared.connectTimeout;
    this.#emitter = new SafeEmitter(prepared.onListenerError);
    this.#heartbeat = new HeartbeatDeadline(prepared.heartbeatTimeout, () => {
      this.#fail(
        transport.connectionError(
          `heartbeat timed out after ${prepared.heartbeatTimeout} milliseconds`,
        ),
        abnormalCloseEvent(),
      );
    });
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
        this.#fail(error, abnormalCloseEvent());
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
   * Frames are handled from the moment the socket opens, before `connect()`
   * resolves, so nothing the server sends early is lost. Each callback
   * ignores events once `attempt` is no longer current, so a session
   * outliving its attempt — however briefly — cannot corrupt a newer
   * connection's state.
   *
   * @param attempt - The attempt the returned handlers belong to.
   * @returns Handlers wired to this watcher.
   */
  #sessionHandlers(attempt: AbortController): WebSocketSessionHandlers {
    return {
      onMessage: (data) => {
        if (this.#attempt !== attempt) return;
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
    this.#heartbeat.reset();

    try {
      session.send(SUBSCRIBE_NEWS);
    } catch (cause) {
      this.#fail(
        this.#transport.connectionError("subscription failed", cause),
        abnormalCloseEvent(),
      );
      return;
    }

    // A custom socket may emit a terminal event synchronously from send().
    // Do not revive a connection that #fail() already made terminal.
    if (this.#state !== "connecting" || this.#session !== session) return;

    this.#state = "open";
    const resolve = this.#resolveConnect;
    this.#resolveConnect = undefined;
    this.#rejectConnect = undefined;
    resolve?.();
  }

  /**
   * Decodes one frame and emits its domain event.
   *
   * @param data - The frame's raw data from the session.
   */
  #handleMessage(data: unknown): void {
    let message: DecodedNewsMessage;
    try {
      message = decodeNewsMessage(frameText(data));
    } catch (cause) {
      const error =
        cause instanceof VeloError
          ? cause
          : new VeloError(`unexpected ${NEWS_WEBSOCKET_PATH} message`, { cause });
      this.#fail(error, abnormalCloseEvent());
      return;
    }

    if (message.type === "heartbeat") {
      this.#heartbeat.reset();
    } else if (message.type === "delete") {
      this.#emitter.emit("delete", { id: message.id });
    } else {
      this.#emitter.emit(message.type, message.story);
    }
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

    this.#emitter.emit("close", cleanCloseEvent());
  }

  #cancel(reason: unknown): void {
    if (this.#state === "closed") return;

    /* Emit only when this call actually ends a connection or attempt. An idle
     * watcher was already cleanly disconnected, and a disconnected watcher
     * already received its remote close; disposing either must not report the
     * same connection ending twice.
     */
    const emitClose = this.#state === "connecting" || this.#state === "open";
    const reject = this.#rejectConnect;
    this.#state = "closed";
    this.#connectPromise = undefined;
    this.#resolveConnect = undefined;
    this.#rejectConnect = undefined;
    this.#teardown();
    this.#stopListeningForAbort();
    reject?.(reason);

    if (emitClose) this.#emitter.emit("close", cleanCloseEvent());
    this.#emitter.clear();
  }

  /**
   * Releases the connection resources: the heartbeat deadline, a pending
   * attempt, and the current session.
   */
  #teardown(): void {
    this.#heartbeat.clear();

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
