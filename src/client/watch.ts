import { backoffMs, DEFAULT_RETRY, validateRetryOptions } from "../transport/retry.ts";
import type { RetryOptions } from "../transport/retry.ts";
import type { WebSocketTransport } from "../transport/websocket.ts";
import { assert } from "../util/assert.ts";
import type { NewsFeedParams } from "./api/news/params.ts";
import { NewsWatcherController } from "./api/news/watcher.ts";
import type { NewsWatcher, NewsWatcherEvents, NewsWatchOptions } from "./api/news/watcher.ts";

/**
 * Every subscription endpoint, keyed by kind.
 *
 * The sibling of `QueryDefinitions` for live data. Watching is its own
 * execution verb over a WebSocket rather than a variation on a query, so it
 * carries a separate registry instead of a tag on a query kind — which is
 * also what keeps `velo.watch()` from accepting a request that can only be
 * fetched over HTTP.
 */
export interface WatchDefinitions {
  "news.feed": {
    params: NewsFeedParams;
    options: NewsWatchOptions;
    events: NewsWatcherEvents;
    watcher: NewsWatcher;
  };
}

/** A subscription endpoint handled by {@link Velo.watch}. */
export type WatchableKind = keyof WatchDefinitions;

/** The endpoint parameters associated with a watchable kind. */
export type WatchParams<K extends WatchableKind> = WatchDefinitions[K]["params"];

/** The live subscription handle associated with a watchable kind. */
export type Watcher<K extends WatchableKind> = WatchDefinitions[K]["watcher"];

type WatchEvents<K extends WatchableKind> = WatchDefinitions[K]["events"];

/** The lifecycle states a subscription moves through. */
export type WatchState = "idle" | "connecting" | "open" | "disconnected" | "closed";

/**
 * The surface every watcher exposes, over its own event map.
 *
 * Stated structurally so the generic machinery — attaching listeners,
 * resuming a drop — can work on any watcher without knowing its kind, and
 * without casting its way past the type system.
 */
export interface WatcherOf<E> {
  readonly state: WatchState;
  on<T extends keyof E>(type: T, listener: (event: E[T]) => void): this;
  off<T extends keyof E>(type: T, listener: (event: E[T]) => void): this;
  connect(): Promise<void>;
  disconnect(): void;
  close(): void;
}

/**
 * One event delivered by a subscription, tagged with its type.
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

/** One event delivered by a watchable kind, tagged with its type. */
export type WatchEvent<K extends WatchableKind> = TaggedEvent<WatchEvents<K>>;

/** Listeners for individual event types, keyed by type. */
export type WatchEventListeners<K extends WatchableKind> = EventListeners<WatchEvents<K>>;

/** A single listener receiving every event the subscription delivers. */
export type WatchEventListener<K extends WatchableKind> = (event: WatchEvent<K>) => void;

/**
 * Event listeners registered before the subscription opens.
 *
 * Either a map of per-type listeners or one catch-all function. Supplying
 * them here rather than through `watcher.on()` removes the gap between
 * constructing a watcher and attaching to it, so no event can be missed.
 */
export type WatchListeners<K extends WatchableKind> =
  | WatchEventListeners<K>
  | WatchEventListener<K>;

/** Subscription options, plus the listeners to attach before connecting. */
export type WatchOptions<K extends WatchableKind> = WatchDefinitions[K]["options"] & {
  readonly on?: WatchListeners<K>;

  /**
   * Reconnects automatically after an unexpected drop.
   *
   * On by default: losing a socket is an infrastructure failure, not an
   * application event, so the subscription resumes itself with jittered
   * backoff and listeners keep firing. Pass `false` to opt out, or partial
   * {@link RetryOptions} to tune the backoff.
   *
   * Intentional endings — `disconnect()`, `close()`, an aborted signal —
   * never reconnect. Events published while disconnected are not replayed.
   */
  readonly reconnect?: boolean | Partial<RetryOptions>;
};

/**
 * Reconnection defaults for a live subscription.
 *
 * A dropped feed keeps retrying rather than giving up after a handful of
 * attempts the way a single HTTP request does — there is no caller waiting on
 * it to fail, and a feed that stops silently is worse than a slow one.
 */
export const DEFAULT_WATCH_RECONNECT: RetryOptions = {
  retries: Number.MAX_SAFE_INTEGER,
  baseDelayMs: DEFAULT_RETRY.baseDelayMs,
  maxDelayMs: 30_000,
};

/** Resolves the reconnect option to backoff parameters, or off. */
export function prepareReconnect(
  reconnect: boolean | Partial<RetryOptions> | undefined,
): RetryOptions | undefined {
  if (reconnect === false) return undefined;
  if (reconnect === undefined || reconnect === true) return DEFAULT_WATCH_RECONNECT;
  assert(
    reconnect !== null && typeof reconnect === "object" && !Array.isArray(reconnect),
    "reconnect must be a boolean or an object",
  );
  const merged = { ...DEFAULT_WATCH_RECONNECT, ...reconnect };
  validateRetryOptions(merged);
  return merged;
}

/**
 * Attaches the listeners supplied to {@link Velo.watch} before it connects.
 *
 * Generic over the event map rather than the kind, so a watcher's own `on`
 * signature checks each listener against the payload it will receive.
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
         * `event` that the union preserves; they come from the same emit.
         */
        on({ type, event } as TaggedEvent<E>);
      });
    }
    return;
  }

  for (const type of Object.keys(on) as (keyof E)[]) {
    const listener = on[type];
    /* Each listener takes its own event; the loop only knows the union, and
     * a listener is only ever invoked with the type it was registered under.
     */
    if (listener) watcher.on(type, listener as (event: E[keyof E]) => void);
  }
}

/**
 * Reopens a subscription after an unexpected drop, with jittered backoff.
 *
 * A watcher lands in `disconnected` only when it lost a connection it did not
 * mean to lose; `disconnect()` leaves it `idle` and `close()` leaves it
 * `closed`, so neither resumes. Each failed attempt emits `close` again,
 * which drives the next backoff step.
 */
export function resumeOnDrop<E extends { close: unknown }>(
  watcher: WatcherOf<E>,
  retry: RetryOptions,
): void {
  let attempt = 0;

  const schedule = (): void => {
    if (attempt >= retry.retries) return;
    const timer = setTimeout(
      () => {
        if (watcher.state !== "disconnected") return;
        void watcher.connect().then(
          () => {
            attempt = 0;
          },
          () => {
            /* The close event this failure emits schedules the next attempt. */
          },
        );
      },
      backoffMs(attempt++, retry),
    );

    /* A pending reconnect must not hold a Node process open on its own.
     * Called optionally because browsers return a plain number from
     * setTimeout, where the method does not exist.
     */
    timer.unref?.();
  };

  watcher.on("close", () => {
    if (watcher.state === "disconnected") schedule();
  });
}

/**
 * A transport-independent request for one Velo subscription endpoint.
 *
 * Deliberately not a distributive conditional: distributing would resolve
 * `kind` through its constraint and lose the type parameter, so the registry
 * lookup in {@link Velo.watch} would no longer know which watcher it built.
 */
export type WatchRequest<
  K extends WatchableKind = WatchableKind,
  P extends WatchParams<K> = WatchParams<K>,
> = {
  readonly kind: K;
  readonly params: P;
};

/** An immutable builder that produces one subscription request. */
export interface WatchBuilder<
  K extends WatchableKind = WatchableKind,
  P extends WatchParams<K> = WatchParams<K>,
> {
  build(): WatchRequest<K, P>;
}

/** A subscription request or a builder that can produce one. */
export type WatchInput<
  K extends WatchableKind = WatchableKind,
  P extends WatchParams<K> = WatchParams<K>,
> = WatchRequest<K, P> | WatchBuilder<K, P>;

interface WatcherDefinition<K extends WatchableKind> {
  /**
   * Builds this kind's watcher.
   *
   * The `WatcherOf` half of the return type is what lets the client attach
   * listeners and resume drops generically: without it, `Watcher<K>` is an
   * opaque indexed access and every call would need a cast.
   */
  create(
    transport: WebSocketTransport,
    options: WatchDefinitions[K]["options"],
  ): Watcher<K> & WatcherOf<WatchEvents<K>>;

  /**
   * Every event type this kind delivers.
   *
   * A record rather than a list so the compiler rejects a kind that gains an
   * event without registering it here, which is what a catch-all listener
   * fans out over.
   */
  readonly events: { readonly [E in keyof WatchEvents<K>]: true };
}

type WatcherRegistry = {
  readonly [K in WatchableKind]: WatcherDefinition<K>;
};

/** Builds the live watcher for one subscription kind. */
export const WATCHERS: WatcherRegistry = Object.freeze({
  "news.feed": {
    create: (transport, options) => new NewsWatcherController(transport, options),
    events: { story: true, edit: true, delete: true, error: true, close: true },
  },
});
