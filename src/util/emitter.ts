export type EmitterListener<Event> = (event: Event) => unknown;

export type ListenerErrorReporter = (error: unknown) => unknown;

type UntypedListener = (event: unknown) => unknown;

/**
 * A minimal typed event emitter whose dispatch never propagates listener
 * failures back into the emitting caller.
 *
 * @remarks
 * Neither platform primitive fits an SDK that emits from transport
 * callbacks: Node's EventEmitter re-throws listener exceptions into the
 * emitter's caller, and EventTarget reports them as uncaught exceptions,
 * which terminates a default-configured Node process. Here a listener that
 * throws, or returns a rejecting promise, is reported without interrupting
 * the remaining listeners.
 */
export class SafeEmitter<Events extends object> {
  readonly #listeners = new Map<keyof Events, Set<UntypedListener>>();
  readonly #report: ListenerErrorReporter | undefined;

  /**
   * Creates an emitter, optionally with custom listener-failure reporting.
   *
   * @param report - Replaces the default reporting for listener failures.
   * When `report` itself throws or returns a rejecting promise, both the
   * original failure and the reporter's own are delivered through the
   * default reporter.
   */
  constructor(report?: ListenerErrorReporter) {
    this.#report = report;
  }

  /**
   * Adds a listener for one event type.
   *
   * @remarks
   * Adding the same listener more than once has no additional effect.
   *
   * @param type - The event type to listen for.
   * @param listener - Called with every emitted event of `type`.
   */
  on<K extends keyof Events>(type: K, listener: EmitterListener<Events[K]>): void {
    let listeners = this.#listeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this.#listeners.set(type, listeners);
    }
    listeners.add(listener as UntypedListener);
  }

  /**
   * Removes a previously added listener.
   *
   * @param type - The event type the listener was added for.
   * @param listener - The listener to remove; unknown listeners are ignored.
   */
  off<K extends keyof Events>(type: K, listener: EmitterListener<Events[K]>): void {
    this.#listeners.get(type)?.delete(listener as UntypedListener);
  }

  /**
   * Delivers `event` to every listener registered for `type`.
   *
   * @remarks
   * Dispatch iterates a snapshot: listeners added during delivery are not
   * called for this event, and listeners removed during delivery still are.
   * A listener failure goes to this emitter's reporter; without a custom
   * one, to `reportError` where the runtime provides it and `console.error`
   * otherwise.
   *
   * @param type - The event type to emit.
   * @param event - The event delivered to each listener.
   */
  emit<K extends keyof Events>(type: K, event: Events[K]): void {
    const listeners = this.#listeners.get(type);
    if (!listeners?.size) return;
    for (const listener of Array.from(listeners)) this.call(listener, event);
  }

  /**
   * Calls one listener as `emit` calls each of its own.
   *
   * @remarks
   * For a listener this emitter does not hold, such as one a caller attached
   * to something narrower than an event type. A throw, or a rejecting promise
   * it returns, goes to this emitter's reporter and never to the caller.
   *
   * @param listener - The listener to call.
   * @param args - What to call it with.
   */
  call<Args extends readonly unknown[]>(listener: (...args: Args) => unknown, ...args: Args): void {
    try {
      const result = listener(...args);
      if (isPromiseLike(result)) {
        void Promise.resolve(result).catch((cause: unknown) => this.#reportFailure(cause));
      }
    } catch (cause) {
      this.#reportFailure(cause);
    }
  }

  /* Removes every listener of every type. */
  clear(): void {
    this.#listeners.clear();
  }

  /**
   * Routes one listener failure to the configured reporter.
   *
   * @param error - The thrown value, or the listener promise's rejection
   * reason.
   */
  #reportFailure(error: unknown): void {
    if (!this.#report) {
      reportListenerError(error);
      return;
    }
    try {
      const result = this.#report(error);
      if (isPromiseLike(result)) {
        void Promise.resolve(result).catch((cause: unknown) => {
          // Match the fallback used when the reporter throws synchronously.
          reportListenerError(error);
          reportListenerError(cause);
        });
      }
    } catch (cause) {
      // A broken reporter must lose neither the original failure nor its own.
      reportListenerError(error);
      reportListenerError(cause);
    }
  }
}

/**
 * Detects thenables without awaiting them.
 *
 * @param value - A listener's return value.
 * @returns Whether `value` is a promise-like object to settle.
 */
function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    ((typeof value === "object" && value !== null) || typeof value === "function") &&
    typeof (value as { readonly then?: unknown }).then === "function"
  );
}

/**
 * Reports a listener failure without interrupting dispatch.
 *
 * @remarks
 * Browsers and Deno surface the failure through `reportError`. Node has no
 * non-fatal equivalent — rethrowing from a task would trigger
 * `uncaughtException` and terminate a default-configured process — so the
 * failure is logged instead.
 *
 * @param error - The thrown value, or the listener promise's rejection
 * reason.
 */
function reportListenerError(error: unknown): void {
  const report = (globalThis as typeof globalThis & { reportError?: (error: unknown) => void })
    .reportError;
  if (typeof report === "function") {
    report(error);
  } else {
    console.error("Velo SDK: uncaught error in event listener", error);
  }
}
