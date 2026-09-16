import {
  channelEndpoint,
  type ChannelDescriptor,
  type ChannelEndpoint,
  type ChannelMessage,
} from "../../../channel/channel.ts";
import { VeloError } from "../../../errors.ts";
import { WebSocketSession } from "../../../transport/session.ts";
import { abnormalCloseEvent } from "../../../transport/websocket.ts";
import type { WebSocketCloseEvent, WebSocketTransport } from "../../../transport/websocket.ts";
import { assert } from "../../../util/assert.ts";
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

export interface ChannelsWatcherEvents<Descriptor extends ChannelDescriptor = ChannelDescriptor> {
  readonly data: ChannelMessage<Descriptor>;
  /** A server rejection or unsolicited unsubscription; other channels continue. */
  readonly channelError: ChannelError;
  readonly error: VeloError;
  readonly close: WebSocketCloseEvent;
}

/**
 * A live channel subscription.
 *
 * The shared watcher contract over the channel event map, which carries the
 * union of the subscribed descriptors so `kind` narrows `data`.
 */
export type ChannelsWatcher<Descriptor extends ChannelDescriptor = ChannelDescriptor> = WatcherOf<
  ChannelsWatcherEvents<Descriptor>
>;

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
 */
export class ChannelsWatcherController implements ChannelsWatcher {
  readonly #active = new Set<string>();
  readonly #connectTimeout: number;
  readonly #descriptors = new Map<string, ChannelDescriptor>();
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
    for (const descriptor of channels) {
      const name = descriptor.channel();
      this.#descriptors.set(name, descriptor);
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
    let frame: ReturnType<typeof decodeChannelFrame>;
    try {
      frame = decodeChannelFrame(data);
    } catch (cause) {
      this.#lifecycle.fail(cause as VeloError, abnormalCloseEvent());
      return;
    }

    if (frame.type === "heartbeat") {
      group.heartbeat.reset();
      return;
    }
    if (frame.type === "control") return;

    const channel = frame.type === "data" ? frame.message.c : frame.error.channel;
    if (!this.#active.has(channel) || !group.channels.includes(channel)) return;
    if (frame.type === "channelError") {
      this.#active.delete(channel);
      this.#lifecycle.emitter.emit("channelError", frame.error);
      return;
    }

    const descriptor = this.#descriptors.get(channel);
    assert(descriptor !== undefined, () => `no descriptor for active channel ${channel}`);
    let decoded: unknown;
    try {
      decoded = descriptor.decode(frame.message);
      if (isThenable(decoded)) {
        /* A mistaken async decoder must not leave an unhandled rejection behind. */
        void Promise.resolve(decoded).catch(() => {});
        throw new VeloError("channel decoders must return synchronously");
      }
    } catch {
      this.#lifecycle.fail(
        new VeloError(`failed to decode channel ${channel}`),
        abnormalCloseEvent(),
      );
      return;
    }
    this.#lifecycle.emitter.emit("data", {
      kind: descriptor.kind,
      channel,
      ...(frame.message.tt === undefined ? {} : { timestamp: frame.message.tt }),
      data: decoded,
      raw: frame.message,
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
