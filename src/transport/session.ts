import type { VeloConnectionError } from "../errors.js";
import { assert } from "../util/assert.js";
import { MAX_TIMER_MS } from "./retry.js";
import type {
  WebSocketCloseEvent,
  WebSocketConnection,
  WebSocketErrorEvent,
  WebSocketEvents,
  WebSocketMessageEvent,
  WebSocketTransport,
} from "./websocket.js";

/* Socket readyStates per the WHATWG WebSocket interface. */
const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;

const ABNORMAL_CLOSE_CODE = 1006;

const IGNORE_SOCKET_ERROR = (): void => {};

export interface WebSocketSessionHandlers {
  /* Receives each frame's data until the session closes. */
  readonly onMessage: (data: unknown) => void;
  /**
   * Receives the terminal outcome when the socket itself errors or closes.
   *
   * Fires at most once per session, before or after `open()` settles, and
   * never for a `close()` the caller initiated. Error events synthesize an
   * abnormal close (code 1006); close events pass their real code with the
   * reason redacted.
   */
  readonly onClose: (close: WebSocketCloseEvent, error: VeloConnectionError) => void;
}

export interface WebSocketSessionOptions {
  /* Maximum milliseconds for the factory plus the opening handshake. */
  readonly timeout: number;
  /* Aborts the open attempt; it does not govern an established session. */
  readonly signal?: AbortSignal;
}

export type WebSocketSessionState = "opening" | "open" | "closed";

interface SessionHooks {
  readonly open: () => void;
  readonly fail: (error: unknown) => void;
}

/**
 * One socket's supervised lifetime: handlers are attached before the
 * handshake completes, socket `error` and `close` are normalized into a
 * single at-most-once `onClose`, and teardown always detaches listeners
 * before closing so no callback fires after the session ends.
 */
export class WebSocketSession {
  readonly #handlers: WebSocketSessionHandlers;
  readonly #hooks: SessionHooks;
  readonly #socket: WebSocketConnection;
  readonly #transport: WebSocketTransport;
  #state: WebSocketSessionState = "opening";

  /**
   * Connects a socket through `transport` and resolves once it is open.
   *
   * @remarks
   * The returned session already forwards messages to `handlers`; frames
   * cannot be missed between the handshake and the first `send()`. When the
   * attempt fails — factory error, timeout, abort, or a socket that errors
   * or closes before opening — the socket is closed, listeners are
   * detached, and the promise rejects.
   *
   * @param transport - Builds the connection target and credential-safe
   * errors.
   * @param handlers - Message and termination callbacks; attached for the
   * session's whole lifetime.
   * @param options - The handshake timeout and an optional abort signal for
   * this attempt.
   * @returns The open session.
   */
  static open(
    transport: WebSocketTransport,
    handlers: WebSocketSessionHandlers,
    options: WebSocketSessionOptions,
  ): Promise<WebSocketSession> {
    const { timeout, signal } = options;
    assert(
      Number.isSafeInteger(timeout) && timeout > 0 && timeout <= MAX_TIMER_MS,
      () =>
        `timeout must be a positive integer of at most ${MAX_TIMER_MS} milliseconds (got ${String(timeout)})`,
    );

    return new Promise<WebSocketSession>((resolve, reject) => {
      let session: WebSocketSession | undefined;
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const settle = (outcome: () => void): void => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        outcome();
      };
      const failAttempt = (error: unknown): void => {
        settle(() => {
          session?.close();
          reject(error);
        });
      };
      const onAbort = (): void => {
        failAttempt(abortReason(signal as AbortSignal));
      };

      if (signal?.aborted) {
        failAttempt(abortReason(signal));
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(() => {
        failAttempt(
          transport.connectionError(`timed out connecting after ${String(timeout)} milliseconds`),
        );
      }, timeout);

      void transport.connect().then(
        (socket) => {
          if (settled) {
            closeSocket(socket);
            return;
          }
          try {
            session = new WebSocketSession(transport, handlers, socket, {
              open: () => settle(() => resolve(session as WebSocketSession)),
              fail: (error) => settle(() => reject(error)),
            });
            session.#start();
          } catch (cause) {
            if (session) session.close();
            else closeSocket(socket);
            settle(() => {
              reject(transport.connectionError("connection setup failed", cause));
            });
          }
        },
        (cause: unknown) => {
          failAttempt(cause);
        },
      );
    });
  }

  private constructor(
    transport: WebSocketTransport,
    handlers: WebSocketSessionHandlers,
    socket: WebSocketConnection,
    hooks: SessionHooks,
  ) {
    this.#transport = transport;
    this.#handlers = handlers;
    this.#socket = socket;
    this.#hooks = hooks;
  }

  get state(): WebSocketSessionState {
    return this.#state;
  }

  /**
   * Sends one text frame.
   *
   * @param data - The frame payload.
   * @throws Whatever the underlying socket's `send` throws; the session
   * stays usable unless the socket also emitted a terminal event.
   */
  send(data: string): void {
    assert(this.#state === "open", "WebSocket session is not open");
    this.#socket.send(data);
  }

  /**
   * Ends the session: detaches all listeners, then closes the socket.
   *
   * @remarks
   * Safe to call more than once. As a caller-initiated end, it does not
   * fire `onClose`.
   */
  close(): void {
    if (this.#state === "closed") return;
    this.#state = "closed";
    this.#detach();
  }

  readonly #onOpen = (): void => {
    if (this.#state !== "opening") return;
    this.#state = "open";
    this.#hooks.open();
  };

  readonly #onMessage = (event: WebSocketMessageEvent): void => {
    if (this.#state === "closed") return;
    this.#handlers.onMessage(event.data);
  };

  readonly #onError = (event: WebSocketErrorEvent): void => {
    if (this.#state === "closed") return;
    const cause = event.error ?? event.message ?? "unknown socket error";
    this.#terminate(
      abnormalCloseEvent(),
      this.#transport.connectionError("connection failed", cause),
    );
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
    this.#terminate(close, this.#transport.connectionError(detail));
  };

  /**
   * Attaches the session and settles sockets that are not CONNECTING.
   *
   * @remarks
   * Runs once after construction, so a registration failure can close the
   * already-assigned session and roll back every listener attached before
   * the failure. A factory may also hand over a socket that is already open,
   * already closing, or reporting a nonsensical readyState.
   */
  #start(): void {
    this.#socket.addEventListener("open", this.#onOpen);
    this.#socket.addEventListener("message", this.#onMessage);
    this.#socket.addEventListener("error", this.#onError);
    this.#socket.addEventListener("close", this.#onClose);

    const { readyState } = this.#socket;
    if (readyState === OPEN) {
      this.#onOpen();
    } else if (readyState >= CLOSING) {
      this.#abandon(this.#transport.connectionError("closed before opening"));
    } else if (readyState !== CONNECTING) {
      this.#abandon(
        this.#transport.connectionError(`has invalid readyState ${String(readyState)}`),
      );
    }
  }

  /**
   * Ends an attempt that can never open, without firing `onClose`.
   *
   * @param error - The rejection for the pending `open()` promise.
   */
  #abandon(error: VeloConnectionError): void {
    this.#state = "closed";
    this.#detach();
    this.#hooks.fail(error);
  }

  /**
   * Ends the session for a socket-initiated terminal event.
   *
   * @param close - The normalized close delivered to `onClose`.
   * @param error - The failure delivered to `onClose` and, when the
   * handshake was still pending, rejecting the `open()` promise.
   */
  #terminate(close: WebSocketCloseEvent, error: VeloConnectionError): void {
    const opening = this.#state === "opening";
    this.#state = "closed";
    this.#detach();
    try {
      this.#handlers.onClose(close, error);
    } finally {
      if (opening) this.#hooks.fail(error);
    }
  }

  #detach(): void {
    removeSocketListener(this.#socket, "open", this.#onOpen);
    removeSocketListener(this.#socket, "message", this.#onMessage);
    removeSocketListener(this.#socket, "error", this.#onError);
    removeSocketListener(this.#socket, "close", this.#onClose);
    closeSocket(this.#socket);
  }
}

/**
 * Closes a socket without letting its shutdown disturb the caller.
 *
 * @remarks
 * `ws.close()` while CONNECTING schedules an asynchronous `error`. Keep a
 * sink installed after the session's listeners are detached so shutdown
 * cannot become an uncaught EventEmitter error in Node.
 *
 * @param socket - The socket to close; may be in any readyState.
 */
function closeSocket(socket: WebSocketConnection): void {
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
    // The session is already terminal; cleanup errors cannot change its state.
  }
}

/**
 * Removes a socket listener, tolerating malformed custom sockets.
 *
 * @param socket - The socket to detach from.
 * @param type - The event type the listener was attached for.
 * @param listener - The listener to remove.
 */
function removeSocketListener<K extends keyof WebSocketEvents>(
  socket: WebSocketConnection,
  type: K,
  listener: (event: WebSocketEvents[K]) => void,
): void {
  try {
    socket.removeEventListener(type, listener);
  } catch {
    // The session is already terminal; cleanup errors cannot change its state.
  }
}

/**
 * Builds the close a session reports when a socket errors without closing.
 *
 * @returns An abnormal-closure event (code 1006).
 */
function abnormalCloseEvent(): WebSocketCloseEvent {
  return { code: ABNORMAL_CLOSE_CODE, reason: "", wasClean: false };
}

/**
 * Extracts a signal's abort reason.
 *
 * @param signal - An aborted signal.
 * @returns The signal's reason, or a default AbortError for runtimes that
 * predate `AbortSignal.reason`.
 */
function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}
