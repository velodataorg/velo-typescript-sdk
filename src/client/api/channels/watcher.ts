import type { ChannelDescriptor, ChannelMessage } from "../../../channel/channel.ts";
import { CHANNELS_WEBSOCKET_PATH, ONDEMAND_WEBSOCKET_PATH } from "../../../constants/endpoints.ts";
import { VeloError } from "../../../errors.ts";
import { MAX_TIMER_MS } from "../../../transport/retry.ts";
import { WebSocketSession } from "../../../transport/session.ts";
import type { WebSocketCloseEvent, WebSocketTransport } from "../../../transport/websocket.ts";
import { assert } from "../../../util/assert.ts";
import { SafeEmitter } from "../../../util/emitter.ts";
import type { WatcherOf, WatchState } from "../../watch/watcher.ts";
import { Channels, type ChannelsParams } from "./channels.ts";
import { decodeChannelFrame, type ChannelError } from "./decode.ts";

export const DEFAULT_CHANNELS_CONNECT_TIMEOUT = 30_000;

export interface ChannelsWatchOptions {
  /** Closes every socket belonging to this watcher when aborted. */
  readonly signal?: AbortSignal;
  /** Deadline for each socket handshake, in milliseconds. */
  readonly connectTimeout?: number;
  /** Receives exceptions and promise rejections from event listeners. */
  readonly onListenerError?: (error: unknown) => unknown;
}

export interface ChannelsWatcherEvents<Descriptor extends ChannelDescriptor = ChannelDescriptor> {
  readonly data: ChannelMessage<Descriptor>;
  /** A server rejection or unsolicited unsubscription; other channels continue. */
  readonly channelError: ChannelError;
  readonly error: VeloError;
  readonly close: WebSocketCloseEvent;
}

export type ChannelsWatcher<Descriptor extends ChannelDescriptor = ChannelDescriptor> = WatcherOf<
  ChannelsWatcherEvents<Descriptor>
>;

interface ChannelGroup {
  readonly transport: WebSocketTransport;
  readonly channels: readonly string[];
}

/** Owns one socket per endpoint for a fixed set of channels. Recovery is supervised by watch(). */
export class ChannelsWatcherController implements ChannelsWatcher {
  readonly #groups: readonly ChannelGroup[];
  readonly #emitter: SafeEmitter<ChannelsWatcherEvents>;
  readonly #signal: AbortSignal | undefined;
  readonly #connectTimeout: number;
  readonly #sessions = new Map<ChannelGroup, WebSocketSession>();
  readonly #active = new Set<string>();
  readonly #descriptors = new Map<string, ChannelDescriptor>();
  #attempt: AbortController | undefined;
  #state: WatchState = "idle";
  #connectPromise: Promise<void> | undefined;
  #resolveConnect: (() => void) | undefined;
  #rejectConnect: ((reason: unknown) => void) | undefined;
  #listeningForAbort = false;

  constructor(
    transport: WebSocketTransport,
    params: ChannelsParams,
    options?: ChannelsWatchOptions,
  ) {
    assert(params !== null && typeof params === "object", "channels params must be an object");
    const { channels } = new Channels().subscribe(params.channels).build().params;
    const prepared = prepareOptions(options);
    this.#signal = prepared.signal;
    this.#connectTimeout = prepared.connectTimeout;
    this.#emitter = new SafeEmitter(prepared.onListenerError);
    const groups = new Map<string, string[]>();
    for (const descriptor of channels) {
      const channel = descriptor.channel();
      this.#descriptors.set(channel, descriptor);
      const path = channel.startsWith("ondemand_")
        ? ONDEMAND_WEBSOCKET_PATH
        : CHANNELS_WEBSOCKET_PATH;
      const names = groups.get(path) ?? [];
      names.push(channel);
      groups.set(path, names);
    }
    this.#groups = Array.from(groups, ([path, names]) => ({
      transport: transport.forPath(path),
      channels: names,
    }));
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
    if (this.#state === "connecting" || this.#state === "open")
      return this.#connectPromise as Promise<void>;
    if (this.#state === "closed")
      return Promise.reject(new VeloError("Channels watcher is closed"));
    this.#state = "connecting";
    const promise = new Promise<void>((resolve, reject) => {
      this.#resolveConnect = resolve;
      this.#rejectConnect = reject;
    });
    this.#connectPromise = promise;
    if (this.#signal?.aborted) {
      this.#end("closed", abortReason(this.#signal));
      return promise;
    }
    if (this.#signal && !this.#listeningForAbort) {
      this.#signal.addEventListener("abort", this.#onAbort, { once: true });
      this.#listeningForAbort = true;
    }
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
          cause instanceof VeloError ? cause : new VeloError("channel connection failed"),
          abnormalClose(),
        );
      },
    );
    return promise;
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
    for (const channel of group.channels) {
      if (this.#attempt !== attempt) return;
      try {
        session.send(`s2 ${channel}`);
      } catch (cause) {
        throw group.transport.connectionError("subscription failed", cause);
      }
    }
  }

  #handleMessage(group: ChannelGroup, data: unknown): void {
    let frame: ReturnType<typeof decodeChannelFrame>;
    try {
      frame = decodeChannelFrame(data);
    } catch (cause) {
      this.#fail(cause as VeloError, abnormalClose());
      return;
    }
    if (frame.type === "control") return;
    const channel = frame.type === "data" ? frame.message.c : frame.error.channel;
    if (!this.#active.has(channel) || !group.channels.includes(channel)) return;
    if (frame.type === "channelError") {
      this.#active.delete(channel);
      this.#emitter.emit("channelError", frame.error);
    } else {
      const descriptor = this.#descriptors.get(channel)!;
      let decoded: unknown;
      try {
        decoded = descriptor.decode(frame.message);
        if (
          decoded !== null &&
          (typeof decoded === "object" || typeof decoded === "function") &&
          typeof (decoded as { then?: unknown }).then === "function"
        ) {
          // A mistaken async decoder must not leave an unhandled rejection behind.
          void Promise.resolve(decoded).catch(() => {});
          throw new VeloError("channel decoders must return synchronously");
        }
      } catch {
        this.#fail(new VeloError(`failed to decode channel ${channel}`), abnormalClose());
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
    const emitClose = this.#state === "connecting" || this.#state === "open";
    const reject = this.#rejectConnect;
    this.#state = state;
    this.#teardown(true);
    reject?.(reason);
    if (state === "closed" && this.#listeningForAbort) {
      this.#signal?.removeEventListener("abort", this.#onAbort);
      this.#listeningForAbort = false;
    }
    if (emitClose) this.#emitter.emit("close", { code: 1000, reason: "", wasClean: true });
    if (state === "closed") this.#emitter.clear();
  }

  #teardown(unsubscribe: boolean): void {
    const attempt = this.#attempt;
    this.#attempt = undefined;
    this.#connectPromise = undefined;
    this.#resolveConnect = undefined;
    this.#rejectConnect = undefined;
    attempt?.abort();
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

function prepareOptions(options?: ChannelsWatchOptions) {
  assert(
    options === undefined ||
      (options !== null && typeof options === "object" && !Array.isArray(options)),
    "channels watch options must be an object",
  );
  const { signal, onListenerError } = options ?? {};
  assert(
    signal === undefined ||
      (signal !== null &&
        typeof signal === "object" &&
        typeof signal.aborted === "boolean" &&
        typeof signal.addEventListener === "function" &&
        typeof signal.removeEventListener === "function"),
    "signal must be an AbortSignal",
  );
  assert(
    onListenerError === undefined || typeof onListenerError === "function",
    "onListenerError must be a function",
  );
  const connectTimeout = options?.connectTimeout ?? DEFAULT_CHANNELS_CONNECT_TIMEOUT;
  assert(
    Number.isSafeInteger(connectTimeout) && connectTimeout > 0 && connectTimeout <= MAX_TIMER_MS,
    "connectTimeout must be a positive integer within the timer range",
  );
  return { signal, onListenerError, connectTimeout };
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

function abnormalClose(): WebSocketCloseEvent {
  return { code: 1006, reason: "", wasClean: false };
}
