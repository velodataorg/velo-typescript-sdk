import type { DescriptorOf } from "../../channel/channel.ts";
import type { ChannelsParams } from "../api/channels/params.ts";
import { ChannelsWatcherController } from "../api/channels/watcher.ts";
import type { ChannelsWatcherEvents, ChannelsWatchOptions } from "../api/channels/watcher.ts";
import { NewsWatcherController } from "../api/news/watcher.ts";
import type { NewsWatcherEvents, NewsWatchOptions } from "../api/news/watcher.ts";
import type { ResumeOptions } from "./connection.ts";
import type { WatchTransports } from "./transports.ts";
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
  "channels.subscribe": {
    params: ChannelsParams;
    options: ChannelsWatchOptions;
    events: ChannelsWatcherEvents;
  };
  "news.feed": {
    /* The live feed takes no parameters: it delivers every published story. */
    params: Record<string, never>;
    options: NewsWatchOptions;
    events: NewsWatcherEvents;
  };
}

/** A subscription endpoint handled by {@link Velo.watch}. */
export type WatchableKind = keyof WatchDefinitions;

/** The endpoint parameters associated with a watchable kind. */
export type WatchParams<K extends WatchableKind> = WatchDefinitions[K]["params"];

/** The live subscription handle associated with a watchable kind. */
export type Watcher<K extends WatchableKind, P extends WatchParams<K> = WatchParams<K>> = WatcherOf<
  WatchEvents<K, P>
>;

export type WatchEvents<
  K extends WatchableKind,
  P extends WatchParams<K> = WatchParams<K>,
> = K extends "channels.subscribe"
  ? P extends ChannelsParams<infer Input>
    ? ChannelsWatcherEvents<DescriptorOf<Input>>
    : never
  : WatchDefinitions[K]["events"];

/** One event delivered by a watchable kind, tagged with its type. */
export type WatchEvent<
  K extends WatchableKind,
  P extends WatchParams<K> = WatchParams<K>,
> = TaggedEvent<WatchEvents<K, P>>;

/** Listeners for individual event types, keyed by type. */
export type WatchEventListeners<
  K extends WatchableKind,
  P extends WatchParams<K> = WatchParams<K>,
> = EventListeners<WatchEvents<K, P>>;

/** A single listener receiving every event the subscription delivers. */
export type WatchEventListener<
  K extends WatchableKind,
  P extends WatchParams<K> = WatchParams<K>,
> = (event: WatchEvent<K, P>) => void;

/**
 * Event listeners registered before the subscription opens.
 *
 * Either a map of per-type listeners or one catch-all function. Supplying
 * them here rather than through `watcher.on()` removes the gap between
 * constructing a watcher and attaching to it, so no event can be missed.
 */
export type WatchListeners<K extends WatchableKind, P extends WatchParams<K> = WatchParams<K>> =
  | WatchEventListeners<K, P>
  | WatchEventListener<K, P>;

/** Subscription options, plus the listeners to attach before connecting. */
export type WatchOptions<
  K extends WatchableKind,
  P extends WatchParams<K> = WatchParams<K>,
> = WatchDefinitions[K]["options"] & {
  readonly on?: WatchListeners<K, P>;

  /**
   * Keeps the subscription connected from its initial attempt onward.
   *
   * On by default: a failed initial connection leaves `watch()` pending while
   * it retries, and an unexpected later drop reconnects with the same jittered
   * backoff. Pass `false` for one initial attempt and no automatic recovery,
   * or partial {@link ResumeOptions} to tune the shared retry policy.
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
   * Takes every transport the client owns and picks the ones this kind
   * needs, so a kind that spans endpoints is built the same way as one that
   * uses a single socket.
   */
  create(
    transports: WatchTransports,
    params: WatchParams<K>,
    options: WatchDefinitions[K]["options"] | undefined,
  ): WatcherOf<WatchEvents<K>>;

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
    create: (transports, _params, options) => new NewsWatcherController(transports.news, options),
    events: { story: true, edit: true, delete: true, error: true, close: true },
  },
  "channels.subscribe": {
    create: (transports, params, options) =>
      new ChannelsWatcherController(transports, params, options),
    events: { data: true, channelError: true, error: true, close: true },
  },
});
