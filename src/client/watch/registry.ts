import type { WebSocketTransport } from "../../transport/websocket.ts";
import { NewsWatcherController } from "../api/news/watcher.ts";
import type { NewsWatcher, NewsWatcherEvents, NewsWatchOptions } from "../api/news/watcher.ts";
import type { ResumeOptions } from "./resume.ts";
import type { EventListeners, TaggedEvent, WatcherOf } from "./watcher.ts";

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
    /* The live feed takes no parameters: it delivers every published story. */
    params: Record<string, never>;
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
   * {@link ResumeOptions} to tune the backoff.
   *
   * Intentional endings — `disconnect()`, `close()`, an aborted signal —
   * never reconnect. Events published while disconnected are not replayed.
   */
  readonly reconnect?: boolean | Partial<ResumeOptions>;
};

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
