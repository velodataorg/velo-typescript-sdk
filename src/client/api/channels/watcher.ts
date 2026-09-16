import {
  channelEndpoint,
  type ChannelDescriptor,
  type ChannelEndpoint,
  type ChannelMessage,
} from "../../../channel/channel.ts";
import { VeloError } from "../../../errors.ts";
import { WebSocketSession } from "../../../transport/session.ts";
import { abnormalCloseEvent, cleanCloseEvent } from "../../../transport/websocket.ts";
import type { WebSocketCloseEvent, WebSocketTransport } from "../../../transport/websocket.ts";
import { abortReason } from "../../../util/abort.ts";
import { assert } from "../../../util/assert.ts";
import { SafeEmitter } from "../../../util/emitter.ts";
import { HeartbeatDeadline } from "../../watch/heartbeat.ts";
import { prepareWatcherOptions } from "../../watch/options.ts";
import type { WatcherOptions } from "../../watch/options.ts";
import type { WatchTransports } from "../../watch/transports.ts";
import type { WatcherOf, WatchState } from "../../watch/watcher.ts";
import { decodeChannelFrame } from "./decode.ts";
import type { ChannelError } from "./decode.ts";
import { ChannelsParams } from "./params.ts";

/** Options for a channel subscription: the contract every watcher shares. */
export type ChannelsWatchOptions = WatcherOptions;

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

/* One socket's share of the subscription: its endpoint and the channels it carries. */
interface ChannelGroup {
  readonly transport: WebSocketTransport;
  readonly channels: readonly string[];
  readonly heartbeat: HeartbeatDeadline;
}

/**
 * A disconnected controller for a fixed set of channels.
 *
 * Opens one socket per endpoint the channels need and subscribes each
 * channel on its socket; `connect()` resolves once every socket is open and
 * subscribed. The controller never reconnects on its own — an unexpected
 * loss on any socket enters `disconnected` and emits `close`, and the watch
 * layer resumes it.
 *
 * Nothing published while disconnected is replayed, and a reconnect
 * resubscribes the original set, including channels the server rejected.
 */
export class ChannelsWatcherController implements ChannelsWatcher {
  readonly #active = new Set<string>();
  readonly #connectTimeout: number;
  readonly #descriptors = new Map<string, ChannelDescriptor>();
  readonly #emitter: SafeEmitter<ChannelsWatcherEvents>;
  readonly #groups: readonly ChannelGroup[];
  readonly #sessions = new Map<ChannelGroup, WebSocketSession>();
  readonly #signal: AbortSignal | undefined;

  #attempt: AbortController | undefined;
  #connectPromise: Promise<void> | undefined;
  #listeningForAbort = false;
  #rejectConnect: ((reason?: unknown) => void) | undefined;
  #resolveConnect: (() => void) | undefined;
  #state: WatchState = "idle";

  constructor(
    transports: Pick<WatchTransports, ChannelEndpoint>,
    params: ChannelsParams,
    options?: ChannelsWatchOptions,
  ) {
    const { channels } = ChannelsParams.parse(params);
    const prepared = prepareWatcherOptions(options);
    this.#signal = prepared.signal;
    this.#connectTimeout = prepared.connectTimeout;
    this.#emitter = new SafeEmitter(prepared.onListenerError);

    const byEndpoint = new Map<ChannelEndpoint, string[]>();
    for (const descriptor of channels) {
      const name = descriptor.channel();
      this.#descriptors.set(name, descriptor);
      const endpoint = channelEndpoint(name);
      const names = byEndpoint.get(endpoint) ?? [];
      names.push(name);
      byEndpoint.set(endpoint, names);
    }
    this.#groups = Array.from(byEndpoint, ([endpoint, names]) => {
      const transport = transports[endpoint];
      return {
        transport,
        channels: names,
        heartbeat: new HeartbeatDeadline(prepared.heartbeatTimeout, () => {
          this.#fail(
            transport.connectionError(
              `heartbeat timed out after ${prepared.heartbeatTimeout} milliseconds`,
            ),
            abnormalCloseEvent(),
          );
        }),
      };
    });
  }

  get state(): WatchState {
    return this.#state;
  }

  on<K extends keyof ChannelsWatcherEvents>(
    type: K,
    listener: (event: ChannelsWatcherEvents[K]) => void,
  ): this {
    this.#emitter.on(type, listener);
    return this;
  }

  off<K extends keyof ChannelsWatcherEvents>(
    type: K,
    listener: (event: ChannelsWatcherEvents[K]) => void,
  ): this {
    this.#emitter.off(type, listener);
    return this;
  }

  connect(): Promise<void> {
    if (this.#state === "connecting" || this.#state === "open") {
      return this.#connectPromise as Promise<void>;
    }
    if (this.#state === "closed") {
      return Promise.reject(new VeloError("Channels watcher is closed"));
    }

    this.#state = "connecting";
    const connectPromise = new Promise<void>((resolve, reject) => {
      this.#resolveConnect = resolve;
      this.#rejectConnect = reject;
    });
    this.#connectPromise = connectPromise;

    if (this.#signal?.aborted) {
      this.#end("closed", abortReason(this.#signal));
      return connectPromise;
    }
    this.#listenForAbort();

    const attempt = new AbortController();
    this.#attempt = attempt;
    for (const group of this.#groups) {
      for (const channel of group.channels) this.#active.add(channel);
    }
    void Promise.all(this.#groups.map((group) => this.#openGroup(group, attempt))).then(
      () => {
        if (this.#attempt !== attempt || this.#state !== "connecting") return;
        this.#state = "open";
        const resolve = this.#resolveConnect;
        this.#resolveConnect = undefined;
        this.#rejectConnect = undefined;
        resolve?.();
      },
      (cause: unknown) => {
        if (this.#attempt !== attempt) return;
        this.#fail(
          cause instanceof VeloError
            ? cause
            : new VeloError("channel connection failed", { cause }),
          abnormalCloseEvent(),
        );
      },
    );

    return connectPromise;
  }

  disconnect(): void {
    if (this.#state === "idle" || this.#state === "closed") return;
    this.#end("idle", new DOMException("The channels watcher was disconnected.", "AbortError"));
  }

  close(): void {
    if (this.#state === "closed") return;
    this.#end("closed", new DOMException("The channels watcher was closed.", "AbortError"));
  }

  readonly #onAbort = (): void => {
    this.#end("closed", abortReason(this.#signal as AbortSignal));
  };

  /**
   * Opens one group's socket and subscribes its channels.
   *
   * @remarks
   * Frames are handled from the moment the socket opens, before `connect()`
   * resolves, so nothing the server sends early is lost. Each step checks
   * that `attempt` is still current: a sibling socket may have failed and
   * torn this attempt down while the handshake was in flight.
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
          if (this.#attempt === attempt) this.#handleMessage(group, data);
        },
        onClose: (close, error) => {
          if (this.#attempt === attempt) this.#fail(error, close);
        },
      },
      { timeout: this.#connectTimeout, signal: attempt.signal },
    );
    if (this.#attempt !== attempt) {
      session.close();
      return;
    }
    this.#sessions.set(group, session);
    group.heartbeat.reset();

    for (const channel of group.channels) {
      /* A custom socket may emit a terminal event synchronously from send(). */
      if (this.#attempt !== attempt) return;
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
      this.#fail(cause as VeloError, abnormalCloseEvent());
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
      this.#emitter.emit("channelError", frame.error);
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
      this.#fail(new VeloError(`failed to decode channel ${channel}`), abnormalCloseEvent());
      return;
    }
    this.#emitter.emit("data", {
      kind: descriptor.kind,
      channel,
      ...(frame.message.tt === undefined ? {} : { timestamp: frame.message.tt }),
      data: decoded,
      raw: frame.message,
    });
  }

  #fail(error: VeloError, close: WebSocketCloseEvent): void {
    if (this.#state !== "connecting" && this.#state !== "open") return;
    const emitError = this.#state === "open";

    const reject = this.#rejectConnect;
    this.#state = "disconnected";
    this.#teardown(false);
    reject?.(error);

    if (emitError) this.#emitter.emit("error", error);
    this.#emitter.emit("close", close);
  }

  #end(state: "idle" | "closed", reason: unknown): void {
    /* Emit only when this call actually ends a connection or attempt: an
     * idle watcher was already cleanly disconnected, and a disconnected one
     * already received its remote close.
     */
    const emitClose = this.#state === "connecting" || this.#state === "open";
    const reject = this.#rejectConnect;
    this.#state = state;
    this.#teardown(true);
    if (state === "closed") this.#stopListeningForAbort();
    reject?.(reason);

    if (emitClose) this.#emitter.emit("close", cleanCloseEvent());
    if (state === "closed") this.#emitter.clear();
  }

  /**
   * Releases the connection resources: heartbeat deadlines, a pending
   * attempt, and every session.
   *
   * @param unsubscribe - Whether to tell the server which channels are being
   * released first. True for an intentional end; a lost connection has no
   * server to tell.
   */
  #teardown(unsubscribe: boolean): void {
    this.#attempt?.abort();
    this.#attempt = undefined;
    this.#connectPromise = undefined;
    this.#resolveConnect = undefined;
    this.#rejectConnect = undefined;

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
