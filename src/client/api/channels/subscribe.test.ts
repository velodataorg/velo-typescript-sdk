import { afterEach, describe, expect, it, vi } from "vitest";

import { channels, Velo } from "../../../index.ts";
import type { Channel, ChannelFrame, WatchOptions } from "../../../index.ts";
import { FakeSocket, flushConnection } from "../../../transport/fake-socket.ts";
import { MAX_CHANNELS_PER_SOCKET } from "./watcher.ts";

const BTC = "realtime_binance-futures:BTCUSDT";
const ETH = "realtime_binance-futures:ETHUSDT";
const SOL = "realtime_binance-futures:SOLUSDT";
const frame = (c: string, d: unknown = [1, 2, 3]) => ({ c, d, tt: 123, f: false });

/**
 * Builds a raw channel that records the payloads and errors it is given.
 *
 * @param name - The wire name to follow.
 * @returns The channel, and what its listeners have been called with.
 */
function recording(name: string) {
  const data = vi.fn();
  const error = vi.fn();
  return { channel: channels.raw(name).on({ data, error }), data, error };
}

/**
 * Opens a feed, opening every socket it dials.
 *
 * @param fed - The channels to feed.
 * @param options - Watch options; reconnecting is off unless asked for.
 * @returns The open watcher, every socket dialled so far, and the connection's events.
 */
async function open(fed: readonly Channel[], options: WatchOptions<"channels.feed"> = {}) {
  const sockets: FakeSocket[] = [];
  const events: string[] = [];
  const client = new Velo({
    apiKey: "key",
    webSocketFactory: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
  });
  const pending = client.watch(channels.feed(fed), {
    reconnect: false,
    on: (event) => {
      events.push(event.type);
    },
    ...options,
  });
  await flushConnection();
  sockets.forEach((socket) => socket.open());
  const watcher = await pending;
  const send = (socket: FakeSocket, sent: object) => socket.message(JSON.stringify(sent));
  return { watcher, sockets, events, send };
}

afterEach(() => vi.useRealTimers());

describe("watcher.subscribe", () => {
  it("starts a channel on the open socket, without reconnecting", async () => {
    const btc = recording(BTC);
    const eth = recording(ETH);
    const { watcher, sockets, events, send } = await open([btc.channel]);

    watcher.subscribe(eth.channel);
    send(sockets[0]!, frame(ETH, [9]));

    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.sent).toEqual([`s2 ${BTC}`, `s2 ${ETH}`]);
    expect(eth.data).toHaveBeenCalledExactlyOnceWith(
      [9],
      expect.objectContaining({ channel: ETH }),
    );
    expect(events).toEqual([]);
    watcher.close();
  });

  it("opens another socket when every socket of the endpoint is full", async () => {
    const names = Array.from(
      { length: MAX_CHANNELS_PER_SOCKET },
      (_, index) => `realtime_test:${String(index)}`,
    );
    const extra = recording("realtime_test:extra");
    const { watcher, sockets, events, send } = await open(
      names.map((name) => recording(name).channel),
    );

    watcher.subscribe(extra.channel);
    await flushConnection();
    expect(sockets).toHaveLength(2);
    expect(sockets[1]!.sent).toEqual([]);
    sockets[1]!.open();
    await flushConnection();

    expect(sockets[0]!.sent).toHaveLength(MAX_CHANNELS_PER_SOCKET);
    expect(sockets[1]!.sent).toEqual(["s2 realtime_test:extra"]);
    send(sockets[1]!, frame("realtime_test:extra"));
    expect(extra.data).toHaveBeenCalledTimes(1);
    expect(watcher.state).toBe("open");
    expect(events).toEqual([]);
    watcher.close();
  });

  it("joins a wire name already followed without subscribing again, and keeps one value once", async () => {
    const first = recording(BTC);
    const second = recording(BTC);
    const { watcher, sockets, send } = await open([first.channel]);

    watcher.subscribe(second.channel);
    watcher.subscribe(second.channel);
    send(sockets[0]!, frame(BTC));

    expect(sockets[0]!.sent).toEqual([`s2 ${BTC}`]);
    expect(first.data).toHaveBeenCalledTimes(1);
    expect(second.data).toHaveBeenCalledTimes(1);
    watcher.close();
  });

  it("refuses what a feed refuses, and a closed watcher", async () => {
    const { watcher } = await open([recording(BTC).channel]);
    const written = { kind: "mine", name: ETH, decode: (sent: ChannelFrame) => sent.d };

    expect(() => watcher.subscribe(written as never)).toThrow("channels.custom()");
    expect(() => watcher.subscribe(channels.raw(ETH))).toThrow(`${ETH} has no data listener`);
    expect(() =>
      watcher.subscribe(
        channels.custom({ kind: "other", name: BTC, decode: () => 1 }).on({ data: () => {} }),
      ),
    ).toThrow(`conflicting channels for ${BTC}: raw and other`);

    watcher.close();
    expect(() => watcher.subscribe(recording(ETH).channel)).toThrow("Channels watcher is closed");
  });

  it("only lists the channel while disconnected, and subscribes it on the next connect", async () => {
    const eth = recording(ETH);
    const { watcher, sockets } = await open([recording(BTC).channel]);
    watcher.disconnect();

    watcher.subscribe(eth.channel);
    expect(sockets).toHaveLength(1);

    const reconnect = watcher.connect();
    await flushConnection();
    sockets[1]!.open();
    await reconnect;
    expect(sockets[1]!.sent).toEqual([`s2 ${BTC}`, `s2 ${ETH}`]);
    watcher.close();
  });

  it("fails the connection when the command cannot be sent, keeping the channel for the next one", async () => {
    const { watcher, sockets, events } = await open([recording(BTC).channel]);
    sockets[0]!.send = () => {
      throw new Error("socket gone");
    };

    expect(() => watcher.subscribe(recording(ETH).channel)).not.toThrow();

    expect(watcher.state).toBe("disconnected");
    expect(events).toEqual(["error", "close"]);
    watcher.close();
  });
});

describe("watcher.unsubscribe", () => {
  it("stops a channel with one u2, and drops what still arrives for it", async () => {
    const btc = recording(BTC);
    const eth = recording(ETH);
    const { watcher, sockets, events, send } = await open([btc.channel, eth.channel]);

    watcher.unsubscribe(btc.channel);
    send(sockets[0]!, frame(BTC));
    send(sockets[0]!, frame(ETH));

    expect(sockets[0]!.sent).toEqual([`s2 ${BTC}`, `s2 ${ETH}`, `u2 ${BTC}`]);
    expect(btc.data).not.toHaveBeenCalled();
    expect(eth.data).toHaveBeenCalledTimes(1);
    expect(watcher.state).toBe("open");
    expect(events).toEqual([]);

    /* On close only what is still followed is released: a second u2 would miscount the socket. */
    watcher.close();
    expect(sockets[0]!.sent.filter((sent) => sent === `u2 ${BTC}`)).toHaveLength(1);
    expect(sockets[0]!.sent.at(-1)).toBe(`u2 ${ETH}`);
  });

  it("takes the value that was passed in, and nothing else", async () => {
    const btc = recording(BTC);
    const { watcher } = await open([btc.channel, recording(ETH).channel]);
    const message = "unsubscribe() takes a channel this watcher follows";

    expect(() => watcher.unsubscribe(recording(BTC).channel)).toThrow(message);
    expect(() => watcher.unsubscribe(recording(SOL).channel)).toThrow(message);
    expect(() => watcher.unsubscribe({ name: BTC } as never)).toThrow(message);
    watcher.unsubscribe(btc.channel);
    expect(() => watcher.unsubscribe(btc.channel)).toThrow(message);
    watcher.close();
  });

  it("keeps the subscription while another channel has the wire name", async () => {
    const first = recording(BTC);
    const second = recording(BTC);
    const { watcher, sockets, send } = await open([first.channel, second.channel]);

    watcher.unsubscribe(first.channel);
    send(sockets[0]!, frame(BTC));

    expect(sockets[0]!.sent).toEqual([`s2 ${BTC}`]);
    expect(first.data).not.toHaveBeenCalled();
    expect(second.data).toHaveBeenCalledTimes(1);
    watcher.close();
  });

  it("refuses the watcher's last channel, pointing at close()", async () => {
    const first = recording(BTC);
    const second = recording(BTC);
    const { watcher, sockets } = await open([first.channel, second.channel]);

    watcher.unsubscribe(first.channel);
    expect(() => watcher.unsubscribe(second.channel)).toThrow(
      `${BTC} is the last channel this watcher follows; close() the watcher instead`,
    );
    expect(sockets[0]!.sent).toEqual([`s2 ${BTC}`]);
    expect(watcher.state).toBe("open");
    watcher.close();
  });

  it("closes a socket it emptied as an intentional end: no error, no close, no reconnect", async () => {
    vi.useFakeTimers();
    const names = Array.from(
      { length: MAX_CHANNELS_PER_SOCKET },
      (_, index) => `realtime_test:${String(index)}`,
    );
    const alone = recording("realtime_test:alone");
    const { watcher, sockets, events } = await open(
      [...names.map((name) => recording(name).channel), alone.channel],
      { reconnect: { baseDelayMs: 0, maxDelayMs: 0 } },
    );
    expect(sockets).toHaveLength(2);

    watcher.unsubscribe(alone.channel);

    expect(sockets[1]!.sent).toEqual(["s2 realtime_test:alone", "u2 realtime_test:alone"]);
    expect(sockets[1]!.readyState).toBe(3);
    expect(sockets[1]!.listenerCount("close")).toBe(0);
    /* The server terminates a socket once its last channel is unsubscribed; nobody is listening. */
    sockets[1]!.remoteClose();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(2);
    expect(watcher.state).toBe("open");
    expect(events).toEqual([]);
    watcher.close();
  });

  it("sends no u2 for a channel the server already stopped", async () => {
    const btc = recording(BTC);
    const { watcher, sockets, send } = await open([btc.channel, recording(ETH).channel]);
    send(sockets[0]!, { u2: BTC });
    expect(btc.error).toHaveBeenCalledExactlyOnceWith({ channel: BTC, reason: "unsubscribed" });

    watcher.unsubscribe(btc.channel);

    expect(sockets[0]!.sent).toEqual([`s2 ${BTC}`, `s2 ${ETH}`]);
    watcher.close();
  });

  it("starts a channel again with the same value", async () => {
    const btc = recording(BTC);
    const { watcher, sockets, send } = await open([btc.channel, recording(ETH).channel]);

    watcher.unsubscribe(btc.channel);
    watcher.subscribe(btc.channel);
    send(sockets[0]!, frame(BTC));

    expect(sockets[0]!.sent).toEqual([`s2 ${BTC}`, `s2 ${ETH}`, `u2 ${BTC}`, `s2 ${BTC}`]);
    expect(btc.data).toHaveBeenCalledTimes(1);
    watcher.close();
  });
});

describe("a reconnect after the set changed", () => {
  it("resubscribes the channels followed then, not the ones the feed began with", async () => {
    vi.useFakeTimers();
    const btc = recording(BTC);
    const sol = recording(SOL);
    const { watcher, sockets, send } = await open([btc.channel, recording(ETH).channel], {
      reconnect: { baseDelayMs: 0, maxDelayMs: 0 },
    });
    watcher.subscribe(sol.channel);
    watcher.unsubscribe(btc.channel);

    sockets[0]!.remoteClose();
    await vi.advanceTimersByTimeAsync(0);
    sockets[1]!.open();
    await vi.advanceTimersByTimeAsync(0);

    expect(watcher.state).toBe("open");
    expect(sockets[1]!.sent).toEqual([`s2 ${ETH}`, `s2 ${SOL}`]);
    send(sockets[1]!, frame(SOL));
    send(sockets[1]!, frame(BTC));
    expect(sol.data).toHaveBeenCalledTimes(1);
    expect(btc.data).not.toHaveBeenCalled();
    watcher.close();
  });
});
