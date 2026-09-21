import { VeloError } from "../../errors.ts";
import { abnormalCloseEvent, cleanCloseEvent } from "../../transport/websocket.ts";
import type { WebSocketCloseEvent } from "../../transport/websocket.ts";
import { abortReason } from "../../util/abort.ts";
import { SafeEmitter } from "../../util/emitter.ts";
import type { PreparedWatcherOptions } from "./options.ts";
import type { WatchState } from "./watcher.ts";

/** The events every watcher emits alongside its own domain events. */
export interface LifecycleEvents {
  readonly error: VeloError;
  readonly close: WebSocketCloseEvent;
}

/** Why an attempt's resources are being released. */
export type TeardownReason = "failed" | "disconnected" | "closed";

export interface WatchLifecycleHooks {
  /**
   * Opens the connection for one attempt.
   *
   * Reports the outcome through {@link WatchLifecycle.ready} or
   * {@link WatchLifecycle.fail}. Runs synchronously inside `connect()`, and a
   * throw counts as a failed attempt.
   */
  readonly start: (attempt: AbortController) => void;
  /**
   * Releases every resource the current attempt holds.
   *
   * Called exactly once per started attempt, after the attempt's signal is
   * aborted and before the connect promise settles or any event is emitted.
   */
  readonly teardown: (reason: TeardownReason) => void;
}

/**
 * The connection lifecycle every watcher shares.
 *
 * Owns the state machine, the promise concurrent `connect()` calls share,
 * the identity of the current attempt, and the order in which a transition
 * releases resources, settles the promise, and emits. A controller supplies
 * only how to open its sockets and how to release them. It learns whether an
 * attempt is still current from that attempt's signal, which is aborted the
 * moment the attempt ends for any reason.
 */
export class WatchLifecycle<E extends LifecycleEvents> {
  readonly emitter: SafeEmitter<E>;
  readonly #hooks: WatchLifecycleHooks;
  readonly #name: string;
  readonly #signal: AbortSignal | undefined;

  #attempt: AbortController | undefined;
  #connectPromise: Promise<void> | undefined;
  #listeningForAbort = false;
  #rejectConnect: ((reason?: unknown) => void) | undefined;
  #resolveConnect: (() => void) | undefined;
  #state: WatchState = "idle";

  /**
   * @param name - Names the watcher in messages, as in "News watcher is closed".
   * @param options - The prepared watcher options; the signal and the
   * listener-error reporter are what the lifecycle uses.
   * @param hooks - How the controller opens and releases its connection.
   */
  constructor(name: string, options: PreparedWatcherOptions, hooks: WatchLifecycleHooks) {
    this.#name = name;
    this.#signal = options.signal;
    this.#hooks = hooks;
    this.emitter = new SafeEmitter(options.onListenerError);
  }

  get state(): WatchState {
    return this.#state;
  }

  connect(): Promise<void> {
    if (this.#state === "connecting" || this.#state === "open") {
      return this.#connectPromise as Promise<void>;
    }
    if (this.#state === "closed") {
      return Promise.reject(new VeloError(`${this.#name} watcher is closed`));
    }

    this.#state = "connecting";
    const connectPromise = new Promise<void>((resolve, reject) => {
      this.#resolveConnect = resolve;
      this.#rejectConnect = reject;
    });
    this.#connectPromise = connectPromise;

    if (this.#signal?.aborted) {
      this.#close(abortReason(this.#signal));
      return connectPromise;
    }
    this.#listenForAbort();

    const attempt = new AbortController();
    this.#attempt = attempt;
    try {
      this.#hooks.start(attempt);
    } catch (cause) {
      this.fail(
        cause instanceof VeloError ? cause : new VeloError("connection failed", { cause }),
        abnormalCloseEvent(),
      );
    }

    return connectPromise;
  }

  disconnect(): void {
    if (this.#state === "idle" || this.#state === "closed") return;
    if (this.#state === "disconnected") {
      this.#state = "idle";
      return;
    }

    const reject = this.#settle();
    this.#state = "idle";
    this.#endAttempt("disconnected");
    reject?.(new DOMException(`The ${this.#name} watcher was disconnected.`, "AbortError"));

    this.#emitLifecycle("close", cleanCloseEvent());
  }

  close(): void {
    if (this.#state === "closed") return;
    this.#close(new DOMException(`The ${this.#name} watcher was closed.`, "AbortError"));
  }

  /**
   * Marks an attempt open and resolves `connect()`.
   *
   * @param attempt - The attempt that finished subscribing.
   * @returns Whether the attempt became the open connection. False when it
   * ended while subscribing — a socket failing synchronously from `send()`,
   * say — in which case the caller must not treat the connection as live.
   */
  ready(attempt: AbortController): boolean {
    if (this.#attempt !== attempt || this.#state !== "connecting") return false;

    this.#state = "open";
    const resolve = this.#resolveConnect;
    this.#resolveConnect = undefined;
    this.#rejectConnect = undefined;
    resolve?.();
    return true;
  }

  /**
   * Ends the current connection or attempt for a failure.
   *
   * @remarks
   * Nothing happens unless the watcher is connecting or open. The connect
   * promise rejects with `error`, and `error` is also emitted when the
   * connection had opened — a caller still awaiting `connect()` receives it
   * through the rejection instead. `close` follows in both cases.
   *
   * @param error - What went wrong.
   * @param close - The close to report, real or synthesized.
   */
  fail(error: VeloError, close: WebSocketCloseEvent): void {
    if (this.#state !== "connecting" && this.#state !== "open") return;
    const emitError = this.#state === "open";

    const reject = this.#settle();
    this.#state = "disconnected";
    this.#endAttempt("failed");
    reject?.(error);

    if (emitError) this.#emitLifecycle("error", error);
    this.#emitLifecycle("close", close);
  }

  readonly #onAbort = (): void => {
    this.#close(abortReason(this.#signal as AbortSignal));
  };

  /**
   * Ends the watcher for good.
   *
   * @remarks
   * `close` is emitted only when this call actually ends a connection or
   * attempt. An idle watcher was already cleanly disconnected, and a
   * disconnected one already received its remote close; disposing either
   * must not report the same connection ending twice.
   *
   * @param reason - The rejection for a pending `connect()`.
   */
  #close(reason: unknown): void {
    const emitClose = this.#state === "connecting" || this.#state === "open";
    const reject = this.#settle();
    this.#state = "closed";
    this.#endAttempt("closed");
    this.#stopListeningForAbort();
    reject?.(reason);

    if (emitClose) this.#emitLifecycle("close", cleanCloseEvent());
    this.emitter.clear();
  }

  /**
   * Retires the current attempt, if one was started.
   *
   * @remarks
   * Aborting the signal first lets every callback the controller wired to
   * this attempt recognize it as stale before the controller's own cleanup
   * runs.
   *
   * @param reason - Passed to the controller's teardown hook.
   */
  #endAttempt(reason: TeardownReason): void {
    const attempt = this.#attempt;
    if (attempt === undefined) return;
    this.#attempt = undefined;
    attempt.abort();
    this.#hooks.teardown(reason);
  }

  /**
   * Forgets the pending connect promise.
   *
   * @returns Its rejecter, for the caller to settle once state is updated.
   */
  #settle(): ((reason?: unknown) => void) | undefined {
    const reject = this.#rejectConnect;
    this.#connectPromise = undefined;
    this.#resolveConnect = undefined;
    this.#rejectConnect = undefined;
    return reject;
  }

  /**
   * Emits one lifecycle event.
   *
   * @remarks
   * `E` may narrow the lifecycle events, so the emitter's parameter type is
   * not provably assignable from the base payloads; the constraint on `E`
   * is what makes the cast sound.
   */
  #emitLifecycle<K extends keyof LifecycleEvents>(type: K, event: LifecycleEvents[K]): void {
    (this.emitter as unknown as SafeEmitter<LifecycleEvents>).emit(type, event);
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
