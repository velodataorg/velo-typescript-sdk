/**
 * The contract every live subscription implements.
 *
 * Sits below both the watchers and the watch layer so an implementation can
 * depend on the contract instead of restating it, and the generic machinery
 * can work on any watcher without knowing its kind.
 */

/** The lifecycle states a live subscription moves through. */
export type WatchState = "idle" | "connecting" | "open" | "disconnected" | "closed";

/** A live subscription over its own event map. */
export interface WatcherOf<E> {
  readonly state: WatchState;

  /**
   * Adds a listener for one decoded or lifecycle event.
   *
   * Adding the same listener more than once has no additional effect.
   */
  on<T extends keyof E>(type: T, listener: (event: E[T]) => void): this;

  /** Removes a previously registered listener. */
  off<T extends keyof E>(type: T, listener: (event: E[T]) => void): this;

  /**
   * Opens the subscription.
   *
   * Concurrent calls share one connection attempt. Not needed for the first
   * connection, which the client performs, nor after an unexpected drop when
   * reconnection is enabled.
   */
  connect(): Promise<void>;

  /**
   * Intentionally closes the current connection while keeping this watcher
   * and its listeners reusable.
   */
  disconnect(): void;

  /** Permanently closes this watcher. Safe to call more than once. */
  close(): void;
}

/**
 * One event tagged with its type.
 *
 * A discriminated union, so a single listener can switch over `type` and get
 * the matching payload narrowed on each branch.
 */
export type TaggedEvent<E> = {
  [T in keyof E]: {
    readonly type: T;
    readonly event: E[T];
  };
}[keyof E];

/** Listeners for individual event types of one event map. */
export type EventListeners<E> = {
  readonly [T in keyof E]?: (event: E[T]) => void;
};

/**
 * Attaches listeners to a watcher before it connects.
 *
 * Generic over the event map rather than a kind, so each listener is checked
 * against the payload it will actually receive.
 *
 * @param watcher - The watcher to attach to.
 * @param events - Every event type this watcher delivers.
 * @param on - Per-type listeners, or one catch-all receiving tagged events.
 */
export function attachWatchListeners<E>(
  watcher: WatcherOf<E>,
  events: { readonly [T in keyof E]: true },
  on: EventListeners<E> | ((event: TaggedEvent<E>) => void),
): void {
  if (typeof on === "function") {
    /* Object.keys widens to string[]; the record's keys are exactly keyof E. */
    for (const type of Object.keys(events) as (keyof E)[]) {
      watcher.on(type, (event) => {
        /* Rebuilding the tagged pair loses the correlation between `type` and
         * `event` that the union preserves; both come from the same emit.
         */
        on({ type, event } as TaggedEvent<E>);
      });
    }
    return;
  }

  for (const type of Object.keys(on) as (keyof E)[]) {
    const listener = on[type];
    /* Each listener takes its own event; the loop only knows the union, and a
     * listener is only ever invoked with the type it was registered under.
     */
    if (listener) watcher.on(type, listener as (event: E[keyof E]) => void);
  }
}
