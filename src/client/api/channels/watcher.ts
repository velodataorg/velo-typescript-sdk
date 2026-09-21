import { VeloError } from "../../../errors.ts";
import { WebSocketSession } from "../../../transport/session.ts";
import { abnormalCloseEvent } from "../../../transport/websocket.ts";
import type { WebSocketCloseEvent, WebSocketTransport } from "../../../transport/websocket.ts";
import { assert } from "../../../util/assert.ts";
import type { Channel, ChannelError, ChannelFrame, ChannelMessage } from "../../channel/channel.ts";
import { isChannel, listenersOf } from "../../channel/create.ts";
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
import { ChannelsParams, parseChannel } from "./params.ts";

/** Options for a channel subscription: the contract every watcher shares. */
export type ChannelsWatchOptions = WatcherOptions;

/* The server terminates a socket on its eleventh subscription. */
export const MAX_CHANNELS_PER_SOCKET = 10;

/*
 * How many frames in a row a channel may fail to decode before it is reported
 * as failing. Each of them is reported to the channel's `error` listener as
 * `decode`; past the limit they stay quiet. The count is reversible: the
 * first frame that decodes clears it.
 */
export const MAX_CONSECUTIVE_DECODE_FAILURES = 3;

/*
 * What the connection itself reports. What a channel delivers, and what goes
 * wrong on one channel, go to that channel's own listeners.
 */
export interface ChannelsWatcherEvents {
  readonly error: VeloError;
  readonly close: WebSocketCloseEvent;
}

/** A live channel subscription: the shared watcher contract, and which channels it follows. */
export interface ChannelsWatcher extends WatcherOf<ChannelsWatcherEvents> {
  /**
   * Starts following a channel, without reconnecting.
   *
   * @remarks
   * The server acknowledges nothing: the channel's first `data` is what
   * shows it started, and a refusal arrives later at its `error` listener. A
   * channel with the wire name of one already followed joins its
   * subscription. The same value again changes nothing.
   *
   * @param channel - A channel built on the `channels` namespace, with a
   * `data` listener.
   * @throws A VeloError when the watcher is closed, the channel is not
   * usable in a feed, or its kind disagrees with one followed under the same
   * wire name.
   */
  subscribe(channel: Channel): void;
  /**
   * Stops following a channel, without reconnecting.
   *
   * @remarks
   * A channel is the value that was passed to the feed or to `subscribe()`;
   * another value built the same way is not it. The server stops sending once
   * the last channel with a wire name goes. `subscribe()` with the same value
   * starts it again.
   *
   * @param channel - The channel to stop.
   * @throws A VeloError when the watcher is closed, the channel is not
   * followed here, or it is the last one: a watcher follows at least one
   * channel, so `close()` it instead.
   */
  unsubscribe(channel: Channel): void;
}

/*
 * One socket's share of the subscription: its endpoint and the wire names it
 * carries, at most the per-socket limit. It lives as long as it carries one.
 */
interface ChannelGroup {
  readonly transport: WebSocketTransport;
  readonly channels: string[];
  readonly heartbeat: HeartbeatDeadline;
}

/**
 * A disconnected controller for a set of channels that can change while open.
 *
 * Owns the sockets the channels need — one per endpoint, or more when an
 * endpoint's channels exceed the per-socket limit — and the v2 `s2`/`u2`
 * commands; the connection lifecycle itself is the shared one. `connect()`
 * resolves once every socket is open and subscribed. The controller never
 * reconnects on its own — an unexpected loss on any socket enters
 * `disconnected` and emits `close`, and the watch layer resumes it.
 *
 * Nothing published while disconnected is replayed, and a reconnect
 * resubscribes the set as it is then, including channels the server rejected.
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
  /* The channel whose decoder reads a wire name's frames: the first one listed for it. */
  readonly #channels = new Map<string, Channel>();
  /* Every channel listed for a wire name. They are one subscription, and each one's listeners are called. */
  readonly #listening = new Map<string, Channel[]>();
  readonly #groups: ChannelGroup[] = [];
  readonly #lifecycle: WatchLifecycle<ChannelsWatcherEvents>;
  readonly #sessions = new Map<ChannelGroup, WebSocketSession>();
  readonly #transports: Pick<WatchTransports, ChannelEndpoint>;
  readonly #heartbeatTimeout: number;
  /* The attempt the open sockets belong to, which a socket opened later joins. */
  #attempt: AbortController | undefined;

  constructor(
    transports: Pick<WatchTransports, ChannelEndpoint>,
    params: ChannelsParams,
    options?: ChannelsWatchOptions,
  ) {
    const { channels } = ChannelsParams.parse(params);
    const prepared = prepareWatcherOptions(options);
    this.#connectTimeout = prepared.connectTimeout;
    this.#heartbeatTimeout = prepared.heartbeatTimeout;
    this.#transports = transports;
    this.#lifecycle = new WatchLifecycle("Channels", prepared, {
      start: (attempt) => this.#open(attempt),
      teardown: (reason) => this.#teardown(reason),
    });

    for (const channel of channels) this.#follow(channel);
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

  subscribe(channel: Channel): void {
    assert(this.state !== "closed", "Channels watcher is closed");
    const { kind, name } = parseChannel(channel);
    const followed = this.#channels.get(name);
    assert(
      followed === undefined || followed.kind === kind,
      () => `conflicting channels for ${name}: ${followed?.kind} and ${kind}`,
    );

    const placed = this.#follow(channel);
    /* Not placed: the wire name was already followed, and the channel joined its subscription. */
    if (placed === undefined || this.#attempt === undefined) return;

    this.#active.add(name);
    const session = this.#sessions.get(placed.group);
    if (session !== undefined) this.#send(placed.group, session, `s2 ${name}`);
    else if (placed.created) this.#openLater(placed.group, this.#attempt);
    /* Otherwise the group's socket is still opening, and subscribes every name it carries once open. */
  }

  unsubscribe(channel: Channel): void {
    assert(this.state !== "closed", "Channels watcher is closed");
    const name = isChannel(channel) ? channel.name : undefined;
    const listening = name === undefined ? undefined : this.#listening.get(name);
    assert(
      name !== undefined && listening?.includes(channel) === true,
      "unsubscribe() takes a channel this watcher follows: the value passed to the feed or to subscribe()",
    );
    const followed = [...this.#listening.values()].reduce((count, list) => count + list.length, 0);
    assert(
      followed > 1,
      `${name} is the last channel this watcher follows; close() the watcher instead`,
    );

    listening.splice(listening.indexOf(channel), 1);
    const next = listening[0];
    if (next !== undefined) {
      /* The subscription stays for the others, read by the first of them. */
      this.#channels.set(name, next);
      return;
    }
    this.#listening.delete(name);
    this.#channels.delete(name);
    this.#strikes.delete(name);

    const group = this.#groups.find((candidate) => candidate.channels.includes(name));
    assert(group !== undefined, () => `no socket carries ${name}`);
    group.channels.splice(group.channels.indexOf(name), 1);
    const session = this.#sessions.get(group);
    /*
     * Only for a name the server still counts: it lowers a socket's count on
     * any `u2`, so one for a name it already stopped would miscount the socket.
     */
    if (this.#active.delete(name) && session?.state === "open") {
      try {
        session.send(`u2 ${name}`);
      } catch {
        // Closing the socket also releases the subscription if sending fails.
      }
    }
    if (group.channels.length === 0) this.#retire(group);
  }

  /**
   * Opens every group's socket for one attempt.
   *
   * @param attempt - The attempt the sockets belong to; its signal cancels
   * the handshakes and marks every callback stale once the attempt ends.
   */
  #open(attempt: AbortController): void {
    this.#attempt = attempt;
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
          /* A group that carries nothing was retired on purpose; its socket ending is no failure. */
          if (!attempt.signal.aborted && this.#groups.includes(group)) {
            this.#lifecycle.fail(error, close);
          }
        },
      },
      { timeout: this.#connectTimeout, signal: attempt.signal },
    );
    /* Every name the group carried may have been unsubscribed while its socket was opening. */
    if (attempt.signal.aborted || !this.#groups.includes(group)) {
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
      this.#report(incoming.error);
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
    const message: ChannelMessage = {
      kind: entry.kind,
      channel,
      ...(incoming.frame.tt === undefined ? {} : { timestamp: incoming.frame.tt }),
      data: decoded,
      frame: incoming.frame,
    };
    for (const listening of this.#listening.get(channel) ?? []) {
      const { data } = listenersOf(listening);
      if (data !== undefined) this.#lifecycle.emitter.call(data, decoded, message);
    }
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
    this.#attempt = undefined;
  }

  /**
   * Lists a channel, and gives its wire name a socket if it has none.
   *
   * @param channel - A channel already checked, whose kind agrees with any
   * other listed for its wire name.
   * @returns The group the wire name was placed in and whether it was made for
   * it, or undefined when the name was already carried.
   */
  #follow(channel: Channel): { group: ChannelGroup; created: boolean } | undefined {
    const { name } = channel;
    const listening = this.#listening.get(name);
    if (listening !== undefined) {
      if (!listening.includes(channel)) listening.push(channel);
      return undefined;
    }
    this.#listening.set(name, [channel]);
    this.#channels.set(name, channel);

    const transport = this.#transports[channelEndpoint(name)];
    const roomy = this.#groups.find(
      (group) => group.transport === transport && group.channels.length < MAX_CHANNELS_PER_SOCKET,
    );
    if (roomy !== undefined) {
      roomy.channels.push(name);
      return { group: roomy, created: false };
    }
    const group: ChannelGroup = {
      transport,
      channels: [name],
      heartbeat: new HeartbeatDeadline(this.#heartbeatTimeout, () => {
        this.#lifecycle.fail(
          transport.connectionError(
            `heartbeat timed out after ${this.#heartbeatTimeout} milliseconds`,
          ),
          abnormalCloseEvent(),
        );
      }),
    };
    this.#groups.push(group);
    return { group, created: true };
  }

  /**
   * Opens the socket of a group made while the connection was already up.
   *
   * @param group - The new group.
   * @param attempt - The attempt the open sockets belong to.
   */
  #openLater(group: ChannelGroup, attempt: AbortController): void {
    void this.#openGroup(group, attempt).catch((cause: unknown) => {
      if (attempt.signal.aborted) return;
      this.#lifecycle.fail(
        cause instanceof VeloError ? cause : new VeloError("channel connection failed", { cause }),
        abnormalCloseEvent(),
      );
    });
  }

  /**
   * Sends one command on an open socket, failing the connection if it cannot.
   *
   * @param group - The group the socket belongs to.
   * @param session - Its open session.
   * @param command - The command to send.
   */
  #send(group: ChannelGroup, session: WebSocketSession, command: string): void {
    try {
      session.send(command);
    } catch (cause) {
      this.#lifecycle.fail(
        group.transport.connectionError("subscription failed", cause),
        abnormalCloseEvent(),
      );
    }
  }

  /**
   * Ends a group that carries nothing, as an intentional end.
   *
   * @remarks
   * The server terminates a socket once its last channel is unsubscribed. The
   * group leaves the list first, so neither that nor closing the socket here
   * counts as a lost connection, which would reconnect the whole feed.
   *
   * @param group - The emptied group.
   */
  #retire(group: ChannelGroup): void {
    this.#groups.splice(this.#groups.indexOf(group), 1);
    group.heartbeat.clear();
    this.#sessions.get(group)?.close();
    this.#sessions.delete(group);
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
   * Every failure is reported until the limit. Reaching it also reports the
   * channel as failing, once, and further failures stay quiet until a frame
   * decodes.
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
    this.#report({ channel, reason: "decode", error, frame });
    /* A listener may have ended the connection, which clears the active set. */
    if (strikes === MAX_CONSECUTIVE_DECODE_FAILURES && this.#active.has(channel)) {
      this.#report({ channel, reason: "failing", error });
    }
  }

  /**
   * Calls the error listener of every channel listed for a wire name.
   *
   * @param event - What went wrong, and on which wire name.
   */
  #report(event: ChannelError): void {
    for (const listening of this.#listening.get(event.channel) ?? []) {
      const { error } = listenersOf(listening);
      if (error !== undefined) this.#lifecycle.emitter.call(error, event);
    }
  }
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
