import type { WebSocketTransport } from "../transport/websocket.ts";
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

/**
 * One event delivered by a subscription, tagged with its type.
 *
 * A discriminated union, so a single listener can switch over `type` and get
 * the matching payload narrowed on each branch.
 */
export type WatchEvent<K extends WatchableKind> = {
  [E in keyof WatchEvents<K>]: {
    readonly type: E;
    readonly event: WatchEvents<K>[E];
  };
}[keyof WatchEvents<K>];

/** Listeners for individual event types, keyed by type. */
export type WatchEventListeners<K extends WatchableKind> = {
  readonly [E in keyof WatchEvents<K>]?: (event: WatchEvents<K>[E]) => void;
};

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
};

/** A transport-independent request for one Velo subscription endpoint. */
export type WatchRequest<
  K extends WatchableKind = WatchableKind,
  P extends WatchParams<K> = WatchParams<K>,
> = K extends WatchableKind
  ? {
      readonly kind: K;
      readonly params: P;
    }
  : never;

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
  create(transport: WebSocketTransport, options: WatchDefinitions[K]["options"]): Watcher<K>;

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
