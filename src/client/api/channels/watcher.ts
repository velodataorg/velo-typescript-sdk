import { VeloError } from "../../../errors.ts";
import { WebSocketSession } from "../../../transport/session.ts";
import { abnormalCloseEvent } from "../../../transport/websocket.ts";
import type { WebSocketCloseEvent, WebSocketTransport } from "../../../transport/websocket.ts";
import { assert } from "../../../util/assert.ts";
import type { Channel, ChannelFrame, ChannelMessage } from "../../channel/channel.ts";
import { channelEndpoint } from "../../channel/name.ts";
import type { ChannelEndpoint } from "../../channel/name.ts";
import { HeartbeatDeadline } from "../../watch/heartbeat.ts";
import { WatchLifecycle } from "../../watch/lifecycle.ts";
import type { TeardownReason } from "../../watch/lifecycle.ts";
import { prepareWatcherOptions } from "../../watch/options.ts";
import type { WatcherOptions } from "../../watch/options.ts";
import type { WatchTransports } from "../../watch/transports.ts";
import type { WatcherOf, WatchState } from "../../watch/watcher.ts";
import { decodeChannelFrame } from "./decode.ts";
import type { ChannelError } from "./decode.ts";
import { ChannelsParams } from "./params.ts";

/** Options for a channel subscription: the contract every watcher shares. */
export type ChannelsWatchOptions = WatcherOptions;

/* The server terminates a socket on its eleventh subscription. */
export const MAX_CHANNELS_PER_SOCKET = 10;

/*
 * How many frames in a row a channel may fail to decode before it is reported
 * as a whole. The count is reversible, so it only decides when the per-frame
 * reports stop: the first frame that decodes clears it.
 */
export const MAX_CONSECUTIVE_DECODE_FAILURES = 3;

/* One frame a channel's decoder refused. The frame is skipped and the channel continues. */
export interface ChannelFrameError {
  readonly channel: string;
  /* Its `cause` is the decoder's own error, such as the schema mismatch. */
  readonly error: VeloError;
  readonly frame: ChannelFrame;
}

export interface ChannelsWatcherEvents<C extends Channel = Channel> {
  readonly data: ChannelMessage<C>;
  /**
   * A frame that could not be decoded.
   *
   * Reported for each failure until a channel reaches
   * {@link MAX_CONSECUTIVE_DECODE_FAILURES} in a row, then not again until the
   * channel has recovered.
   */
  readonly frameError: ChannelFrameError;
  /**
   * A channel that stopped delivering; other channels continue.
   *
   * Either the server rejected or dropped it, or its frames kept failing to
   * decode. The second kind keeps its subscription and resumes `data` by
   * itself once a frame decodes.
   */
  readonly channelError: ChannelError;
  readonly error: VeloError;
  readonly close: WebSocketCloseEvent;
}

/**
 * A live channel subscription.
 *
 * The shared watcher contract over the channel event map, which carries the
 * union of the subscribed channels so `kind` narrows `data`.
 */
export type ChannelsWatcher<C extends Channel = Channel> = WatcherOf<ChannelsWatcherEvents<C>>;

/*
 * One socket's share of the subscription: its endpoint and the channels it
 * carries. An endpoint gets as many groups as the per-socket limit requires.
 */
interface ChannelGroup {
  readonly transport: WebSocketTransport;
  readonly channels: readonly string[];
  readonly heartbeat: HeartbeatDeadline;
}

/**
 * A disconnected controller for a fixed set of channels.
 *
 * Owns the sockets the channels need — one per endpoint, or more when an
 * endpoint's channels exceed the per-socket limit — and the v2 `s2`/`u2`
 * commands; the connection lifecycle itself is the shared one. `connect()`
 * resolves once every socket is open and subscribed. The controller never
 * reconnects on its own — an unexpected loss on any socket enters
 * `disconnected` and emits `close`, and the watch layer resumes it.
 *
 * Nothing published while disconnected is replayed, and a reconnect
 * resubscribes the original set, including channels the server rejected.
 *
 * A frame its channel cannot decode costs that frame alone: it is reported
 * and skipped, and neither the socket nor the other channels are affected.
 * Only a frame that cannot be attributed to a channel fails the connection.
 */
export class ChannelsWatcherController implements ChannelsWatcher {
  readonly #active = new Set<string>();
  /* Consecutive decode failures per channel; absent means the last frame decoded. */
  readonly #strikes = new Map<string, number>();
  readonly #connectTimeout: number;
  readonly #channels = new Map<string, Channel>();
  readonly #groups: readonly ChannelGroup[];
  readonly #lifecycle: WatchLifecycle<ChannelsWatcherEvents>;
  readonly #sessions = new Map<ChannelGroup, WebSocketSession>();

  constructor(
    transports: Pick<WatchTransports, ChannelEndpoint>,
    params: ChannelsParams,
    options?: ChannelsWatchOptions,
  ) {
    const { channels } = ChannelsParams.parse(params);
    const prepared = prepareWatcherOptions(options);
    this.#connectTimeout = prepared.connectTimeout;
    this.#lifecycle = new WatchLifecycle("Channels", prepared, {
      start: (attempt) => this.#open(attempt),
      teardown: (reason) => this.#teardown(reason),
    });

    const byEndpoint = new Map<ChannelEndpoint, string[]>();
    for (const entry of channels) {
      const name = entry.name;
      this.#channels.set(name, entry);
      const endpoint = channelEndpoint(name);
      const names = byEndpoint.get(endpoint) ?? [];
      names.push(name);
      byEndpoint.set(endpoint, names);
    }
    const groups: ChannelGroup[] = [];
    for (const [endpoint, names] of byEndpoint) {
      const transport = transports[endpoint];
      for (const shard of chunk(names, MAX_CHANNELS_PER_SOCKET)) {
        groups.push({
          transport,
          channels: shard,
          heartbeat: new HeartbeatDeadline(prepared.heartbeatTimeout, () => {
            this.#lifecycle.fail(
              transport.connectionError(
                `heartbeat timed out after ${prepared.heartbeatTimeout} milliseconds`,
              ),
              abnormalCloseEvent(),
            );
          }),
        });
      }
    }
    this.#groups = groups;
  }

  get state(): WatchState {
    return this.#lifecycle.state;
  }

  on<K extends keyof ChannelsWatcherEvents>(
    type: K,
    listener: (event: ChannelsWatcherEvents[K]) => void,
  ): this {
    this.#lifecycle.emitter.on(type, listener);
    return this;
  }

  off<K extends keyof ChannelsWatcherEvents>(
    type: K,
    listener: (event: ChannelsWatcherEvents[K]) => void,
  ): this {
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
   * Opens every group's socket for one attempt.
   *
   * @param attempt - The attempt the sockets belong to; its signal cancels
   * the handshakes and marks every callback stale once the attempt ends.
   */
  #open(attempt: AbortController): void {
    for (const group of this.#groups) {
      for (const channel of group.channels) this.#active.add(channel);
    }
    void Promise.all(this.#groups.map((group) => this.#openGroup(group, attempt))).then(
      () => {
        this.#lifecycle.ready(attempt);
      },
      (cause: unknown) => {
        if (attempt.signal.aborted) return;
        this.#lifecycle.fail(
          cause instanceof VeloError
            ? cause
            : new VeloError("channel connection failed", { cause }),
          abnormalCloseEvent(),
        );
      },
    );
  }

  /**
   * Opens one group's socket and subscribes its channels.
   *
   * @remarks
   * Frames are handled from the moment the socket opens, before `connect()`
   * resolves, so nothing the server sends early is lost. Each step checks
   * that `attempt` has not ended: a sibling socket may have failed and torn
   * this attempt down while the handshake was in flight.
   *
   * @param group - The endpoint and channels to open.
   * @param attempt - The connection attempt this socket belongs to.
   * @throws When the handshake fails or a subscription cannot be sent.
   */
  async #openGroup(group: ChannelGroup, attempt: AbortController): Promise<void> {
    const session = await WebSocketSession.open(
      group.transport,
      {
        onMessage: (data) => {
          if (!attempt.signal.aborted) this.#handleMessage(group, data);
        },
        onClose: (close, error) => {
          if (!attempt.signal.aborted) this.#lifecycle.fail(error, close);
        },
      },
      { timeout: this.#connectTimeout, signal: attempt.signal },
    );
    if (attempt.signal.aborted) {
      session.close();
      return;
    }
    this.#sessions.set(group, session);
    group.heartbeat.reset();

    for (const channel of group.channels) {
      /* A custom socket may emit a terminal event synchronously from send(). */
      if (attempt.signal.aborted) return;
      try {
        session.send(`s2 ${channel}`);
      } catch (cause) {
        throw group.transport.connectionError("subscription failed", cause);
      }
    }
  }

  /**
   * Decodes one frame and emits its domain event.
   *
   * @param group - The socket the frame arrived on.
   * @param data - The frame's raw data from the session.
   */
  #handleMessage(group: ChannelGroup, data: unknown): void {
    let incoming: ReturnType<typeof decodeChannelFrame>;
    try {
      incoming = decodeChannelFrame(data);
    } catch (cause) {
      this.#lifecycle.fail(cause as VeloError, abnormalCloseEvent());
      return;
    }

    if (incoming.type === "heartbeat") {
      group.heartbeat.reset();
      return;
    }
    if (incoming.type === "control") return;

    const channel = incoming.type === "data" ? incoming.frame.c : incoming.error.channel;
    if (!this.#active.has(channel) || !group.channels.includes(channel)) return;
    if (incoming.type === "channelError") {
      this.#active.delete(channel);
      this.#lifecycle.emitter.emit("channelError", incoming.error);
      return;
    }

    const entry = this.#channels.get(channel);
    assert(entry !== undefined, () => `no channel registered for active ${channel}`);
    let decoded: unknown;
    try {
      decoded = entry.decode(incoming.frame);
      if (isThenable(decoded)) {
        /* A mistaken async decoder must not leave an unhandled rejection behind. */
        void Promise.resolve(decoded).catch(() => {});
        throw new VeloError("channel decoders must return synchronously");
      }
    } catch (cause) {
      this.#strike(channel, incoming.frame, cause);
      return;
    }
    this.#strikes.delete(channel);
    this.#lifecycle.emitter.emit("data", {
      kind: entry.kind,
      channel,
      ...(incoming.frame.tt === undefined ? {} : { timestamp: incoming.frame.tt }),
      data: decoded,
      frame: incoming.frame,
    });
  }

  /**
   * Releases the heartbeat deadlines and every session.
   *
   * @param reason - Why the attempt ended. An intentional end tells the
   * server which channels are being released first; a lost connection has
   * no server to tell.
   */
  #teardown(reason: TeardownReason): void {
    const unsubscribe = reason !== "failed";
    for (const group of this.#groups) group.heartbeat.clear();
    for (const [group, session] of this.#sessions) {
      if (unsubscribe && session.state === "open") {
        for (const channel of group.channels) {
          if (!this.#active.has(channel)) continue;
          try {
            session.send(`u2 ${channel}`);
          } catch {
            // Closing the socket also releases subscriptions if sending fails.
          }
        }
      }
      session.close();
    }
    this.#sessions.clear();
    this.#active.clear();
    this.#strikes.clear();
  }

  /**
   * Records one frame a channel could not decode.
   *
   * @remarks
   * The frame is skipped and the subscription kept, so the frames that keep
   * arriving are what shows the channel has recovered. Unsubscribing instead
   * would last until the next reconnect, and the server terminates a socket
   * that unsubscribes its last channel, which would reconnect the whole feed.
   *
   * Every failure is reported until the limit. Reaching it reports the
   * channel once, and further failures stay quiet until a frame decodes.
   *
   * @param channel - The channel the frame belongs to.
   * @param frame - The frame that could not be decoded.
   * @param cause - What the decoder threw.
   */
  #strike(channel: string, frame: ChannelFrame, cause: unknown): void {
    const strikes = (this.#strikes.get(channel) ?? 0) + 1;
    if (strikes > MAX_CONSECUTIVE_DECODE_FAILURES) return;
    this.#strikes.set(channel, strikes);

    const error = new VeloError(`failed to decode channel ${channel}`, { cause });
    this.#lifecycle.emitter.emit("frameError", { channel, error, frame });
    /* A frameError listener may have ended the connection, which clears the active set. */
    if (strikes === MAX_CONSECUTIVE_DECODE_FAILURES && this.#active.has(channel)) {
      this.#lifecycle.emitter.emit("channelError", { channel, reason: "decode", error });
    }
  }
}

/**
 * Splits a list into consecutive runs of at most `size` items.
 *
 * @param items - The list to split; order is preserved.
 * @param size - The maximum run length.
 * @returns The runs, the last possibly shorter.
 */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const runs: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    runs.push(items.slice(start, start + size));
  }
  return runs;
}

/**
 * Detects a promise-like decoder result without awaiting it.
 *
 * @param value - A decoder's return value.
 * @returns Whether `value` exposes a `then` method.
 */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { readonly then?: unknown }).then === "function"
  );
}
