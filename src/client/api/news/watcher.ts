import { NEWS_WEBSOCKET_PATH } from "../../../constants/endpoints.ts";
import { VeloError } from "../../../errors.ts";
import { frameText } from "../../../transport/frame.ts";
import { WebSocketSession } from "../../../transport/session.ts";
import type { WebSocketSessionHandlers } from "../../../transport/session.ts";
import { abnormalCloseEvent } from "../../../transport/websocket.ts";
import type { WebSocketCloseEvent, WebSocketTransport } from "../../../transport/websocket.ts";
import { HeartbeatDeadline } from "../../watch/heartbeat.ts";
import { WatchLifecycle } from "../../watch/lifecycle.ts";
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
 * Owns one socket and the v1 `subscribe` command; the connection lifecycle
 * itself is the shared one. The controller never reconnects on its own — it
 * reports an unexpected loss by entering `disconnected` and emitting
 * `close`, and `connect()` reopens it. Resuming automatically is the watch
 * layer's job, so every subscription kind gets it from one place.
 *
 * Nothing published while disconnected is replayed: `begin` filters news on
 * publication time, so a reconnect recovers new stories only, never edits or
 * deletions applied to older ones.
 */
export class NewsWatcherController implements NewsWatcher {
  readonly #connectTimeout: number;
  readonly #heartbeat: HeartbeatDeadline;
  readonly #lifecycle: WatchLifecycle<NewsWatcherEvents>;
  readonly #transport: WebSocketTransport;

  #session: WebSocketSession | undefined;

  constructor(transport: WebSocketTransport, options?: NewsWatchOptions) {
    const prepared = prepareWatcherOptions(options);
    this.#transport = transport;
    this.#connectTimeout = prepared.connectTimeout;
    this.#lifecycle = new WatchLifecycle("News", prepared, {
      start: (attempt) => this.#open(attempt),
      teardown: () => this.#teardown(),
    });
    this.#heartbeat = new HeartbeatDeadline(prepared.heartbeatTimeout, () => {
      this.#lifecycle.fail(
        transport.connectionError(
          `heartbeat timed out after ${prepared.heartbeatTimeout} milliseconds`,
        ),
        abnormalCloseEvent(),
      );
    });
  }

  get state(): NewsWatcherState {
    return this.#lifecycle.state;
  }

  on<K extends keyof NewsWatcherEvents>(type: K, listener: NewsWatcherListener<K>): this {
    this.#lifecycle.emitter.on(type, listener);
    return this;
  }

  off<K extends keyof NewsWatcherEvents>(type: K, listener: NewsWatcherListener<K>): this {
    this.#lifecycle.emitter.off(type, listener);
    return this;
  }

  connect(): Promise<void> {
    return this.#lifecycle.connect();
  }

  disconnect(): void {
    this.#lifecycle.disconnect();
  }

  close(): void {
    this.#lifecycle.close();
  }

  /**
   * Opens the socket for one attempt.
   *
   * @param attempt - The attempt the socket belongs to; its signal cancels
   * the handshake and marks every callback stale once the attempt ends.
   */
  #open(attempt: AbortController): void {
    void WebSocketSession.open(this.#transport, this.#sessionHandlers(attempt), {
      timeout: this.#connectTimeout,
      signal: attempt.signal,
    }).then(
      (session) => {
        this.#subscribe(attempt, session);
      },
      (cause: unknown) => {
        if (attempt.signal.aborted) return;
        const error =
          cause instanceof VeloError
            ? cause
            : this.#transport.connectionError("connection failed", cause);
        this.#lifecycle.fail(error, abnormalCloseEvent());
      },
    );
  }

  /**
   * Builds the session callbacks for one connection attempt.
   *
   * @remarks
   * Frames are handled from the moment the socket opens, before `connect()`
   * resolves, so nothing the server sends early is lost. Each callback
   * ignores events once `attempt` has ended, so a session outliving its
   * attempt — however briefly — cannot corrupt a newer connection's state.
   *
   * @param attempt - The attempt the returned handlers belong to.
   * @returns Handlers wired to this watcher.
   */
  #sessionHandlers(attempt: AbortController): WebSocketSessionHandlers {
    return {
      onMessage: (data) => {
        if (attempt.signal.aborted) return;
        this.#handleMessage(data);
      },
      onClose: (close, error) => {
        if (attempt.signal.aborted) return;
        this.#lifecycle.fail(error, close);
      },
    };
  }

  /**
   * Subscribes on a freshly opened session and settles `connect()`.
   *
   * @remarks
   * A custom socket may emit a terminal event synchronously from `send()`,
   * ending the attempt before this method returns; `ready()` refuses such
   * an attempt, so a connection `fail()` already ended is never revived.
   *
   * @param attempt - The attempt that opened `session`.
   * @param session - The open session to subscribe on.
   */
  #subscribe(attempt: AbortController, session: WebSocketSession): void {
    if (attempt.signal.aborted) {
      session.close();
      return;
    }
    this.#session = session;
    this.#heartbeat.reset();

    try {
      session.send(SUBSCRIBE_NEWS);
    } catch (cause) {
      this.#lifecycle.fail(
        this.#transport.connectionError("subscription failed", cause),
        abnormalCloseEvent(),
      );
      return;
    }

    this.#lifecycle.ready(attempt);
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
      this.#lifecycle.fail(error, abnormalCloseEvent());
      return;
    }

    if (message.type === "heartbeat") {
      this.#heartbeat.reset();
    } else if (message.type === "delete") {
      this.#lifecycle.emitter.emit("delete", { id: message.id });
    } else {
      this.#lifecycle.emitter.emit(message.type, message.story);
    }
  }

  /** Releases the heartbeat deadline and the current session. */
  #teardown(): void {
    this.#heartbeat.clear();
    const session = this.#session;
    this.#session = undefined;
    session?.close();
  }
}
