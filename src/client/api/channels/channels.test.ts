import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { REALTIME_WEBSOCKET_PATH } from "../../../constants/endpoints.ts";
import {
  channels,
  DEFAULT_WATCH_HEARTBEAT_TIMEOUT,
  Velo,
  VeloError,
  type Channel,
  type ChannelFrame,
  type ChannelDecodeError,
  type ChannelMessage,
  type RawChannel,
} from "../../../index.ts";
import {
  FakeSocket,
  flushConnection,
  ThrowingSendSocket,
  SynchronouslyFailingSendSocket,
} from "../../../transport/fake-socket.ts";
import {
  WebSocketTransport,
  type WebSocketFactory,
  type WebSocketTarget,
} from "../../../transport/websocket.ts";
import { decodeChannelFrame } from "./decode.ts";
import {
  ChannelsWatcherController,
  MAX_CHANNELS_PER_SOCKET,
  MAX_CONSECUTIVE_DECODE_FAILURES,
} from "./watcher.ts";

const PRICE = "realtime_binance-futures:BTCUSDT";
const OI = "realtime_BTC#open_interest#Coins#Aggregated";
const ONDEMAND = "ondemand_hyperliquid_spot_UBTC-USDC_candle_1";
const rawChannels = (...names: string[]) => names.map((name) => channels.raw(name));
const message = (c = PRICE, d: unknown = [1, 2, 3]) => ({ c, d, tt: 123, f: false });
const rawMessage = (raw: ChannelFrame): ChannelMessage<RawChannel> => ({
  kind: "raw",
  channel: raw.c,
  ...(raw.tt === undefined ? {} : { timestamp: raw.tt }),
  data: raw.d,
  frame: raw,
});

function harness(factory?: WebSocketFactory) {
  const sockets: FakeSocket[] = [];
  const targets: WebSocketTarget[] = [];
  const webSocketFactory: WebSocketFactory =
    factory ??
    ((target) => {
      targets.push(target);
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    });
  const client = new Velo({ apiKey: "test/key", webSocketFactory });
  return { client, sockets, targets };
}

afterEach(() => vi.useRealTimers());

describe("raw channel subscriptions", () => {
  it("accepts raw channels, collapses repeats, and never infers a market kind", async () => {
    const { client, sockets } = harness();
    const price = channels.raw(PRICE);
    expect(price.kind).toBe("raw");
    expect(price.name).toBe(PRICE);
    expect(Object.isFrozen(price)).toBe(true);
    const seen: ChannelMessage<RawChannel>[] = [];
    const pending = client.watch(channels.feed([price, channels.raw(PRICE), channels.raw(OI)]), {
      on: {
        data: (event) => {
          expectTypeOf(event.kind).toEqualTypeOf<"raw">();
          if (event.channel === price.name) seen.push(event);
        },
      },
    });
    await flushConnection();
    sockets[0]!.open();
    const watcher = await pending;
    sockets[0]!.message(JSON.stringify(message()));
    sockets[0]!.message(JSON.stringify(message(OI)));
    expect(sockets[0]!.sent).toEqual([`s2 ${PRICE}`, `s2 ${OI}`]);
    expect(seen).toEqual([rawMessage(message())]);
    watcher.close();
  });

  it("requires arrays at runtime and in TypeScript", () => {
    expect(() => {
      // @ts-expect-error feed takes one array, not a single string
      channels.feed(PRICE);
    }).toThrow(/array/);
    const rejected = () => {
      // @ts-expect-error feed does not take variadic channel arguments
      channels.feed(channels.raw(PRICE), channels.raw(OI));
    };
    expect(rejected).toBeTypeOf("function");
  });

  it("routes channels through their decoders and narrows mixed data by kind", async () => {
    const { client, sockets } = harness();
    // Synthetic channels exercise the contract without implementing market builders.
    const numeric: Channel<"numeric", { value: number }> = {
      kind: "numeric",
      name: "test_numbers",
      decode: (frame) => {
        if (typeof frame.d !== "number") throw new Error("expected a number");
        return { value: frame.d };
      },
    };
    const label: Channel<"label", string> = {
      kind: "label",
      name: "test_labels",
      decode: (frame) => {
        if (typeof frame.d !== "string") throw new Error("expected a label");
        return frame.d;
      },
    };
    const seen: unknown[] = [];
    const pending = client.watch(channels.feed([numeric, label, channels.raw(PRICE)]), {
      on: {
        data: (event) => {
          expectTypeOf(event.kind).toEqualTypeOf<"numeric" | "label" | "raw">();
          if (event.kind === "numeric") {
            expectTypeOf(event.data).toEqualTypeOf<{ value: number }>();
            expect(event.channel).toBe(numeric.name);
          } else if (event.kind === "label") {
            expectTypeOf(event.data).toEqualTypeOf<string>();
          } else {
            expectTypeOf(event.data).toEqualTypeOf<unknown>();
          }
          seen.push(event);
        },
      },
    });
    await flushConnection();
    sockets[0]!.open();
    const watcher = await pending;
    watcher.on("data", (event) => {
      if (event.kind === "numeric") expectTypeOf(event.data.value).toEqualTypeOf<number>();
    });
    const numberFrame = message(numeric.name, 42);
    const labelFrame = message(label.name, "BTC");
    sockets[0]!.message(JSON.stringify(numberFrame));
    sockets[0]!.message(JSON.stringify(labelFrame));
    sockets[0]!.message(JSON.stringify(message()));
    expect(seen).toEqual([
      {
        kind: "numeric",
        channel: numeric.name,
        timestamp: 123,
        data: { value: 42 },
        frame: numberFrame,
      },
      { kind: "label", channel: label.name, timestamp: 123, data: "BTC", frame: labelFrame },
      rawMessage(message()),
    ]);
    watcher.close();
  });

  it("preserves channel types in direct requests and tagged listeners", async () => {
    const { client, sockets } = harness();
    const descriptor: Channel<"count", number> = {
      kind: "count",
      name: "test_count",
      decode: (): number => 1,
    };
    const seen = vi.fn();
    const pending = client.watch(
      { kind: "channels.feed", params: { channels: [descriptor] } },
      {
        on: (event) => {
          if (event.type === "data") {
            expectTypeOf(event.event.kind).toEqualTypeOf<"count">();
            expectTypeOf(event.event.data).toEqualTypeOf<number>();
            seen(event.event);
          }
        },
      },
    );
    await flushConnection();
    sockets[0]!.open();
    const watcher = await pending;
    sockets[0]!.message('{"c":"test_count"}');
    expect(seen).toHaveBeenCalledWith({
      kind: "count",
      channel: "test_count",
      data: 1,
      frame: { c: "test_count" },
    });
    watcher.close();
  });

  it("snapshots kind and decoder, dedupes by kind, and rejects conflicting kinds", async () => {
    const { client, sockets } = harness();
    const descriptor = { kind: "count", name: PRICE, decode: (): number => 1 };
    const request = channels.feed([descriptor, descriptor]);
    expect(request.build().params.channels).toHaveLength(1);
    expect(() => channels.feed([descriptor, channels.raw(PRICE)])).toThrow(/conflicting channels/);
    expect(
      channels.feed([descriptor, { ...descriptor, decode: (): number => 2 }]).build().params
        .channels,
    ).toHaveLength(1);
    descriptor.kind = "changed";
    descriptor.name = OI;
    descriptor.decode = () => 2;
    const data = vi.fn();
    const pending = client.watch(request, { on: { data } });
    await flushConnection();
    sockets[0]!.open();
    const watcher = await pending;
    sockets[0]!.message(JSON.stringify(message()));
    expect(sockets[0]!.sent).toEqual([`s2 ${PRICE}`]);
    expect(data).toHaveBeenCalledWith({
      kind: "count",
      channel: PRICE,
      data: 1,
      timestamp: 123,
      frame: message(),
    });
    watcher.close();
  });

  it.each([
    { kind: "test", name: PRICE },
    { kind: "", name: PRICE, decode: (): number => 1 },
    { kind: "test", name: () => PRICE, decode: (): number => 1 },
    { kind: "test", name: "bad\nchannel", decode: (): number => 1 },
  ])("validates channel contracts before connecting", (value) => {
    const { client, sockets } = harness();
    expect(() =>
      client.watch({
        kind: "channels.feed",
        params: { channels: [value as unknown as Channel] },
      }),
    ).toThrow(VeloError);
    expect(sockets).toHaveLength(0);
  });

  it("keeps frame-level raw messages intact without fabricating a timestamp", async () => {
    const { client, sockets } = harness();
    const seen = vi.fn();
    const pending = client.watch(channels.feed(rawChannels("news_priority")), {
      on: { data: seen },
    });
    await flushConnection();
    sockets[0]!.open();
    const watcher = await pending;
    const raw = { c: "news_priority", headline: "test", kind: "untrusted", channel: "untrusted" };
    sockets[0]!.message(JSON.stringify(raw));
    expect(seen).toHaveBeenCalledWith({
      kind: "raw",
      channel: "news_priority",
      data: undefined,
      frame: raw,
    });
    watcher.close();
  });

  it.each([
    () => {
      throw new Error("invalid payload");
    },
    () => Promise.reject(new Error("mistaken async decoder")),
  ])("reports a decoder failure for its frame alone and keeps the socket open", async (decode) => {
    const { client, sockets } = harness();
    const data = vi.fn();
    const error = vi.fn();
    const decodeError = vi.fn();
    const pending = client.watch(channels.feed([{ kind: "test", name: PRICE, decode }]), {
      reconnect: false,
      on: { data, error, decodeError },
    });
    await flushConnection();
    sockets[0]!.open();
    const watcher = await pending;
    sockets[0]!.message(JSON.stringify(message()));
    await flushConnection();
    expect(data).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(decodeError).toHaveBeenCalledExactlyOnceWith({
      channel: PRICE,
      error: expect.objectContaining({ message: `failed to decode channel ${PRICE}` }),
      frame: message(),
    });
    expect((decodeError.mock.calls[0]![0] as ChannelDecodeError).error.cause).toBeInstanceOf(Error);
    expect(watcher.state).toBe("open");
    expect(sockets[0]!.readyState).toBe(1);
    watcher.close();
  });

  it("reports a failing channel once, stays quiet, and recovers on a good frame", async () => {
    const { client, sockets } = harness();
    /* Decodes numbers and refuses anything else, so a test picks each frame's outcome. */
    const strict = {
      kind: "strict" as const,
      name: PRICE,
      decode: (frame: ChannelFrame): number => {
        if (typeof frame.d !== "number") throw new Error("not a number");
        return frame.d;
      },
    };
    const seen: string[] = [];
    const channelErrors = vi.fn();
    const pending = client.watch(channels.feed([strict, channels.raw(OI)]), {
      reconnect: false,
      on: (event) => {
        seen.push(event.type === "data" ? `data:${event.event.channel}` : event.type);
        if (event.type === "channelError") channelErrors(event.event);
      },
    });
    await flushConnection();
    sockets[0]!.open();
    const watcher = await pending;
    const send = (c: string, d: unknown) => sockets[0]!.message(JSON.stringify(message(c, d)));
    const bad = () => send(PRICE, "bad");
    const take = () => seen.splice(0);

    /* Below the limit every failure is reported, and a good frame clears the count. */
    bad();
    bad();
    send(PRICE, 1);
    expect(take()).toEqual(["decodeError", "decodeError", `data:${PRICE}`]);

    /* So the run starts over: the limit is reached on the third failure, not the first. */
    bad();
    bad();
    expect(channelErrors).not.toHaveBeenCalled();
    bad();
    expect(take()).toEqual(["decodeError", "decodeError", "decodeError", "channelError"]);
    expect(channelErrors).toHaveBeenCalledExactlyOnceWith({
      channel: PRICE,
      reason: "decode",
      error: expect.objectContaining({ message: `failed to decode channel ${PRICE}` }),
    });

    /* Past the limit the channel is quiet, and its sibling never stopped delivering. */
    for (let failure = 0; failure < MAX_CONSECUTIVE_DECODE_FAILURES * 2; failure++) bad();
    send(OI, [1]);
    expect(take()).toEqual([`data:${OI}`]);

    /* The subscription was kept, so a readable frame is delivered and the channel is healthy. */
    send(PRICE, 2);
    bad();
    expect(take()).toEqual([`data:${PRICE}`, "decodeError"]);
    expect(sockets[0]!.sent).toEqual([`s2 ${PRICE}`, `s2 ${OI}`]);
    expect(watcher.state).toBe("open");
    watcher.close();
  });

  it("starts every channel's failure count over on a reconnect", async () => {
    vi.useFakeTimers();
    const { client, sockets } = harness();
    const decodeError = vi.fn();
    const channelError = vi.fn();
    const refusing = {
      kind: "refusing",
      name: PRICE,
      decode: (): never => {
        throw new Error("refused");
      },
    };
    const pending = client.watch(channels.feed([refusing]), {
      reconnect: { baseDelayMs: 0, maxDelayMs: 0 },
      on: { decodeError, channelError },
    });
    await flushConnection();
    sockets[0]!.open();
    const watcher = await pending;
    for (let failure = 0; failure < MAX_CONSECUTIVE_DECODE_FAILURES + 2; failure++) {
      sockets[0]!.message(JSON.stringify(message()));
    }
    expect(decodeError).toHaveBeenCalledTimes(MAX_CONSECUTIVE_DECODE_FAILURES);
    expect(channelError).toHaveBeenCalledTimes(1);

    sockets[0]!.remoteClose();
    await vi.advanceTimersByTimeAsync(0);
    sockets[1]!.open();
    await vi.advanceTimersByTimeAsync(0);
    expect(watcher.state).toBe("open");

    sockets[1]!.message(JSON.stringify(message()));
    expect(decodeError).toHaveBeenCalledTimes(MAX_CONSECUTIVE_DECODE_FAILURES + 1);
    expect(channelError).toHaveBeenCalledTimes(1);
    watcher.close();
  });

  it("still fails the connection on a frame no channel can be blamed for", async () => {
    const { client, sockets } = harness();
    const error = vi.fn();
    const decodeError = vi.fn();
    const pending = client.watch(channels.feed(rawChannels(PRICE)), {
      reconnect: false,
      on: { error, decodeError },
    });
    await flushConnection();
    sockets[0]!.open();
    const watcher = await pending;
    sockets[0]!.message("{broken");
    expect(decodeError).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/JSON/) }),
    );
    expect(watcher.state).toBe("disconnected");
    watcher.close();
  });

  it("snapshots and deduplicates channels without translating names or opening a socket", () => {
    const { client, sockets } = harness();
    const names = [PRICE, PRICE, "realtime_hyperliquid:BTC-USD#funding_rate#Rate (%)"];
    const inputs = rawChannels(...names);
    const builder = channels.feed(inputs);
    inputs.push(channels.raw(OI));
    expect(client.channels).toBe(channels);
    expect(sockets).toHaveLength(0);
    expect(builder.build().kind).toBe("channels.feed");
    expect(builder.build().params.channels.map((item) => item.name)).toEqual(names.slice(1, 3));
    expect(builder.build().params.channels.every((item) => item.kind === "raw")).toBe(true);
    expect(Object.isFrozen(builder.build().params.channels)).toBe(true);
    expect(channels.feed(rawChannels(PRICE)).build().params.channels[0]!.name).toBe(PRICE);
  });

  it.each(["", " channel", "channel ", "a\ns2 b", "a\r", "a\0", 42, null])(
    "rejects invalid channel names: %j",
    (name) => {
      expect(() => channels.raw(name as string)).toThrow(VeloError);
    },
  );

  it.each([[], null, [PRICE], [42], [channels.raw(PRICE), PRICE]])(
    "takes a non-empty array of channels, not bare names: %j",
    (value) => {
      expect(() => channels.feed(value as never)).toThrow(VeloError);
    },
  );

  it("points a bare name at channels.raw()", () => {
    expect(() => channels.feed([PRICE] as never)).toThrow(/channels\.raw\(\)/);
  });

  it("validates direct requests before creating a socket", () => {
    const { client, sockets } = harness();
    expect(() => client.watch({ kind: "channels.feed", params: { channels: [] } })).toThrow(
      /non-empty/,
    );
    expect(sockets).toHaveLength(0);
  });

  it("multiplexes data on one authenticated socket and preserves unknown payloads", async () => {
    const { client, sockets, targets } = harness();
    const seen: ChannelMessage<RawChannel>[] = [];
    const pending = client.watch(channels.feed(rawChannels(PRICE, OI, PRICE)), {
      on: {
        data: (event) => {
          expectTypeOf(event.data).toEqualTypeOf<unknown>();
          expectTypeOf(event.kind).toEqualTypeOf<"raw">();
          seen.push(event);
        },
      },
    });
    await flushConnection();
    expect(sockets).toHaveLength(1);
    expect(targets[0]).toEqual({
      url: "wss://api.velo.xyz/api/w/connect",
      authenticatedUrl: "wss://api.velo.xyz/api/w/connect/test%2Fkey",
      headers: { authorization: `Basic ${btoa("api:test/key")}` },
    });
    const socket = sockets[0]!;
    socket.openWithMessages(JSON.stringify(message()));
    const watcher = await pending;
    expect(socket.sent).toEqual([`s2 ${PRICE}`, `s2 ${OI}`]);
    socket.message(
      JSON.stringify({ ...message(OI, { realtime_bybit: [10, 11, 12] }), extra: "preserved" }),
    );
    socket.message(JSON.stringify(message("unrequested")));
    socket.message(JSON.stringify({ heartbeat: true }));
    socket.message(JSON.stringify({ hb: 1 }));
    socket.message(JSON.stringify({ s2: PRICE }));
    expect(seen).toEqual([
      rawMessage(message()),
      rawMessage({ ...message(OI, { realtime_bybit: [10, 11, 12] }), extra: "preserved" }),
    ]);
    watcher.close();
    expect(socket.sent.slice(-2)).toEqual([`u2 ${PRICE}`, `u2 ${OI}`]);
    expect(socket.readyState).toBe(3);
    expect(watcher.state).toBe("closed");
  });

  it("routes on-demand channels to a separate endpoint and waits for both sockets", async () => {
    const { client, sockets, targets } = harness();
    const seen = vi.fn();
    let ready = false;
    const pending = client
      .watch(channels.feed(rawChannels(PRICE, ONDEMAND)), { on: { data: seen } })
      .then((watcher) => {
        ready = true;
        return watcher;
      });
    await flushConnection();
    expect(targets.map((target) => target.url)).toEqual([
      "wss://api.velo.xyz/api/w/connect",
      "wss://api.velo.xyz/api/o/connect",
    ]);
    expect(targets[1]!.authenticatedUrl).toBe("wss://api.velo.xyz/api/o/connect/test%2Fkey");
    sockets[0]!.open();
    await flushConnection();
    expect(ready).toBe(false);
    sockets[1]!.open();
    const watcher = await pending;
    expect(sockets[1]!.sent).toEqual([`s2 ${ONDEMAND}`]);
    sockets[0]!.message(JSON.stringify(message(ONDEMAND)));
    sockets[1]!.message(JSON.stringify(message(ONDEMAND)));
    expect(seen).toHaveBeenCalledTimes(1);
    watcher.close();
    expect(sockets.every((socket) => socket.readyState === 3)).toBe(true);
  });

  it("overrides the channel host without changing the news endpoint or credentials", async () => {
    const targets: WebSocketTarget[] = [];
    const client = new Velo({
      apiKey: "key",
      baseUrl: "https://api.example.test",
      channelsBaseUrl: "https://data.example.test",
      webSocketFactory: (target) => {
        targets.push(target);
        const socket = new FakeSocket();
        socket.readyState = 1;
        return socket;
      },
    });
    const raw = await client.watch(channels.feed(rawChannels(PRICE)));
    const news = await client.watch(client.news.feed());
    expect(targets.map((target) => target.url)).toEqual([
      "wss://data.example.test/api/w/connect",
      "wss://api.example.test/api/w/connect",
    ]);
    expect(targets[0]!.headers).toEqual(targets[1]!.headers);
    raw.close();
    news.close();
  });

  it("reports rejected and server-unsubscribed channels while continuing others", async () => {
    const { client, sockets } = harness();
    const errors = vi.fn();
    const data = vi.fn();
    const pending = client.watch(channels.feed(rawChannels(PRICE, OI, ONDEMAND)), {
      on: { channelError: errors, data },
    });
    await flushConnection();
    sockets.forEach((socket) => socket.open());
    const watcher = await pending;
    sockets[0]!.message(JSON.stringify({ err: OI }));
    sockets[1]!.message(JSON.stringify({ u2: ONDEMAND }));
    sockets[0]!.message(JSON.stringify({ err: "unrequested" }));
    sockets[0]!.message(JSON.stringify(message(OI)));
    sockets[0]!.message(JSON.stringify(message()));
    expect(errors.mock.calls.map((call) => call[0])).toEqual([
      { channel: OI, reason: "rejected" },
      { channel: ONDEMAND, reason: "unsubscribed" },
    ]);
    expect(data).toHaveBeenCalledTimes(1);
    expect(watcher.state).toBe("open");
    watcher.close();
  });

  it("supports tagged listeners and isolates listener failures", async () => {
    const { client, sockets } = harness();
    const thrown = new Error("listener failed");
    const onListenerError = vi.fn();
    const seen: string[] = [];
    const pending = client.watch(channels.feed(rawChannels(PRICE)), {
      onListenerError,
      on: (event) => {
        seen.push(event.type);
        if (event.type === "data") {
          expectTypeOf(event.event).toEqualTypeOf<ChannelMessage<RawChannel>>();
          throw thrown;
        }
      },
    });
    await flushConnection();
    sockets[0]!.open();
    const watcher = await pending;
    sockets[0]!.message(JSON.stringify(message()));
    expect(onListenerError).toHaveBeenCalledWith(thrown);
    expect(watcher.state).toBe("open");
    watcher.close();
    expect(seen).toEqual(["data", "close"]);
  });

  it("resubscribes all channels after a drop and stops after intentional disconnect", async () => {
    vi.useFakeTimers();
    const { client, sockets } = harness();
    const pending = client.watch(channels.feed(rawChannels(PRICE, OI)), {
      reconnect: { baseDelayMs: 0, maxDelayMs: 0 },
    });
    await flushConnection();
    sockets[0]!.open();
    const watcher = await pending;
    sockets[0]!.remoteClose();
    await vi.advanceTimersByTimeAsync(0);
    sockets[1]!.open();
    await vi.advanceTimersByTimeAsync(0);
    expect(watcher.state).toBe("open");
    expect(sockets[1]!.sent).toEqual([`s2 ${PRICE}`, `s2 ${OI}`]);
    watcher.disconnect();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(2);
    const reconnect = watcher.connect();
    await flushConnection();
    sockets[2]!.open();
    await reconnect;
    watcher.close();
    await expect(watcher.connect()).rejects.toThrow(/closed/);
  });

  it("closes sibling sockets when one endpoint fails", async () => {
    const { client, sockets } = harness();
    const pending = client.watch(channels.feed(rawChannels(PRICE, ONDEMAND)), { reconnect: false });
    const rejection = expect(pending).rejects.toThrow(/gone/);
    await flushConnection();
    sockets[0]!.open();
    await flushConnection();
    sockets[1]!.error(new Error("gone"));
    await rejection;
    expect(sockets.every((socket) => socket.readyState === 3)).toBe(true);
    expect(sockets.every((socket) => socket.listenerCount("message") === 0)).toBe(true);
  });

  it("aborts a partially opened subscription and releases signal listeners", async () => {
    const { client, sockets } = harness();
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const pending = client.watch(channels.feed(rawChannels(PRICE, ONDEMAND)), {
      signal: controller.signal,
    });
    const rejection = expect(pending).rejects.toThrow("stop");
    await flushConnection();
    sockets[0]!.open();
    await flushConnection();
    controller.abort(new Error("stop"));
    await rejection;
    expect(sockets.every((socket) => socket.readyState === 3)).toBe(true);
    expect(remove.mock.calls).toHaveLength(add.mock.calls.length);
  });

  it("does not dial when already aborted", async () => {
    const { client, sockets } = harness();
    await expect(
      client.watch(channels.feed(rawChannels(PRICE)), {
        signal: AbortSignal.abort(new Error("cancelled")),
      }),
    ).rejects.toThrow("cancelled");
    expect(sockets).toHaveLength(0);
  });

  it.each([ThrowingSendSocket, SynchronouslyFailingSendSocket])(
    "does not revive a subscription when send fails",
    async (Socket) => {
      const socket = new Socket();
      socket.readyState = 1;
      const { client } = harness(() => socket);
      await expect(
        client.watch(channels.feed(rawChannels(PRICE, OI)), { reconnect: false }),
      ).rejects.toThrow(/fail|subscribe/);
      expect(socket.readyState).toBe(3);
      expect(socket.sent).not.toContain(`s2 ${OI}`);
    },
  );

  it("bounds the initial handshake and closes late sockets", async () => {
    vi.useFakeTimers();
    let deliver: ((socket: FakeSocket) => void) | undefined;
    const { client } = harness(
      () =>
        new Promise((resolve) => {
          deliver = resolve;
        }),
    );
    const pending = client.watch(channels.feed(rawChannels(PRICE)), {
      reconnect: false,
      connectTimeout: 10,
    });
    const rejection = expect(pending).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(10);
    await rejection;
    const late = new FakeSocket();
    deliver!(late);
    await flushConnection();
    expect(late.readyState).toBe(3);
  });

  it("shares concurrent connect attempts and stops malformed early frames", async () => {
    const sockets: FakeSocket[] = [];
    const transport = new WebSocketTransport({ apiKey: "key" }, REALTIME_WEBSOCKET_PATH, () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    });
    const watcher = new ChannelsWatcherController(
      { realtime: transport, ondemand: transport },
      { channels: rawChannels(PRICE) },
    );
    const pending = watcher.connect();
    expect(watcher.connect()).toBe(pending);
    const rejection = expect(pending).rejects.toThrow(/JSON/);
    await flushConnection();
    sockets[0]!.openWithMessages("{broken");
    await rejection;
    expect(watcher.state).toBe("disconnected");
    watcher.close();
  });

  it("shards an endpoint's channels across sockets at the server's per-socket limit", async () => {
    const { client, sockets, targets } = harness();
    const names = Array.from(
      { length: MAX_CHANNELS_PER_SOCKET * 2 + 1 },
      (_, index) => `realtime_test:${String(index)}`,
    );
    const seen: string[] = [];
    const pending = client.watch(channels.feed(rawChannels(...names, ONDEMAND)), {
      on: { data: (event) => seen.push(event.channel) },
    });
    await flushConnection();

    expect(targets.map((target) => target.url)).toEqual([
      "wss://api.velo.xyz/api/w/connect",
      "wss://api.velo.xyz/api/w/connect",
      "wss://api.velo.xyz/api/w/connect",
      "wss://api.velo.xyz/api/o/connect",
    ]);
    sockets.forEach((socket) => socket.open());
    const watcher = await pending;
    expect(sockets.map((socket) => socket.sent.length)).toEqual([
      MAX_CHANNELS_PER_SOCKET,
      MAX_CHANNELS_PER_SOCKET,
      1,
      1,
    ]);
    expect(sockets[2]!.sent).toEqual([`s2 ${names[MAX_CHANNELS_PER_SOCKET * 2]}`]);

    /* Each shard delivers only its own channels; a frame on the wrong socket is dropped. */
    sockets[0]!.message(JSON.stringify(message(names[0])));
    sockets[0]!.message(JSON.stringify(message(names[MAX_CHANNELS_PER_SOCKET])));
    sockets[1]!.message(JSON.stringify(message(names[MAX_CHANNELS_PER_SOCKET])));
    expect(seen).toEqual([names[0], names[MAX_CHANNELS_PER_SOCKET]]);

    watcher.close();
    expect(sockets.every((socket) => socket.readyState === 3)).toBe(true);
    expect(sockets[2]!.sent.at(-1)).toBe(`u2 ${names[MAX_CHANNELS_PER_SOCKET * 2]}`);
  });

  it("keeps exactly the per-socket limit on one socket", async () => {
    const { client, sockets } = harness();
    const names = Array.from(
      { length: MAX_CHANNELS_PER_SOCKET },
      (_, index) => `realtime_test:${String(index)}`,
    );
    const pending = client.watch(channels.feed(rawChannels(...names)));
    await flushConnection();
    expect(sockets).toHaveLength(1);
    sockets[0]!.open();
    const watcher = await pending;
    expect(sockets[0]!.sent).toHaveLength(MAX_CHANNELS_PER_SOCKET);
    watcher.close();
  });

  it("fails a socket whose heartbeats stop, whatever its channels send", async () => {
    vi.useFakeTimers();
    const { client, sockets } = harness();
    const data = vi.fn();
    const errors = vi.fn();
    const pending = client.watch(channels.feed(rawChannels(PRICE)), {
      reconnect: false,
      on: { data, error: errors },
    });
    await flushConnection();
    sockets[0]!.open();
    const watcher = await pending;

    await vi.advanceTimersByTimeAsync(DEFAULT_WATCH_HEARTBEAT_TIMEOUT - 1);
    sockets[0]!.message(JSON.stringify({ hb: 1 }));
    await vi.advanceTimersByTimeAsync(DEFAULT_WATCH_HEARTBEAT_TIMEOUT - 1);
    sockets[0]!.message(JSON.stringify(message()));
    expect(data).toHaveBeenCalledTimes(1);
    expect(watcher.state).toBe("open");

    await vi.advanceTimersByTimeAsync(1);
    expect(watcher.state).toBe("disconnected");
    expect(errors).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("heartbeat timed out") }),
    );
    expect(sockets[0]!.readyState).toBe(3);
  });

  it("tracks the heartbeat deadline per socket", async () => {
    vi.useFakeTimers();
    const { client, sockets } = harness();
    const pending = client.watch(channels.feed(rawChannels(PRICE, ONDEMAND)), {
      reconnect: false,
      heartbeatTimeout: 100,
    });
    await flushConnection();
    sockets.forEach((socket) => socket.open());
    const watcher = await pending;

    await vi.advanceTimersByTimeAsync(99);
    sockets[0]!.message(JSON.stringify({ hb: 1 }));
    await vi.advanceTimersByTimeAsync(1);

    expect(watcher.state).toBe("disconnected");
    expect(sockets.every((socket) => socket.readyState === 3)).toBe(true);
  });
});

describe("raw channel frames", () => {
  it("handles the live server hb heartbeat without consuming channel data with extra fields", () => {
    expect(decodeChannelFrame('{"hb":1}')).toEqual({ type: "heartbeat" });
    const raw = { ...message(), hb: 1, heartbeat: true };
    expect(decodeChannelFrame(JSON.stringify(raw))).toEqual({ type: "data", frame: raw });
  });

  it("decodes Buffer and ArrayBuffer payloads without aggregating or renaming fields", () => {
    const wire = JSON.stringify(message(OI, { realtime_bybit: [1, 2, 3] }));
    expect(decodeChannelFrame(Buffer.from(wire))).toEqual({
      type: "data",
      frame: JSON.parse(wire),
    });
    expect(decodeChannelFrame(new TextEncoder().encode(wire).buffer)).toEqual({
      type: "data",
      frame: JSON.parse(wire),
    });
    expect(decodeChannelFrame('{"c":"news_priority","headline":"test"}')).toEqual({
      type: "data",
      frame: { c: "news_priority", headline: "test" },
    });
  });

  it.each(["bad json", "[]", "null", "42", "{}", '{"c":"a","tt":"1"}', '{"c":"a","f":1}'])(
    "rejects malformed frames: %s",
    (wire) => {
      expect(() => decodeChannelFrame(wire)).toThrow(VeloError);
    },
  );
});
