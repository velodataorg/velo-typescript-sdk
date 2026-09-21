import { describe, expect, it, vi } from "vitest";

import { channels, Velo } from "../../../index.ts";
import type { Channel, ChannelFrame, WatchOptions } from "../../../index.ts";
import { FakeSocket, flushConnection } from "../../../transport/fake-socket.ts";
import { MAX_CONSECUTIVE_DECODE_FAILURES } from "./watcher.ts";

const BTC = { exchange: "binance-futures", coin: "BTC", product: "BTCUSDT" } as const;
const PRICE = "realtime_binance-futures:BTCUSDT";
const OI = "realtime_BTC#open_interest#Coins#Aggregated";
const PRICE_FRAME = { c: PRICE, d: [1, 4, 1, 3, 10, 30], tt: 1789720859999, f: false };
const OI_FRAME = { c: OI, d: { realtime_bybit: [3, 1, 2] }, tt: 1789720859999, f: false };

/**
 * Opens a feed over one fake socket.
 *
 * @param fed - The channels to feed.
 * @param options - Watch options beside the ones every test here passes.
 * @returns The open watcher, its socket, and a way to make the server send a frame.
 */
async function open(fed: readonly Channel[], options: WatchOptions<"channels.feed"> = {}) {
  const sockets: FakeSocket[] = [];
  const client = new Velo({
    apiKey: "key",
    webSocketFactory: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
  });
  const pending = client.watch(channels.feed(fed), { reconnect: false, ...options });
  await flushConnection();
  sockets[0]!.open();
  const watcher = await pending;
  const socket = sockets[0]!;
  const send = (frame: object) => socket.message(JSON.stringify(frame));
  return { watcher, socket, send };
}

describe("a channel's own listeners in a feed", () => {
  it("calls each channel's data with what it decoded, and the message it came in", async () => {
    const rows = vi.fn();
    const entries = vi.fn();
    const { watcher, send } = await open([
      channels.price(BTC).on({ data: rows }),
      channels.openInterest({ coin: "BTC" }, { metric: "coins" }).on({ data: entries }),
    ]);

    send(PRICE_FRAME);
    send(OI_FRAME);

    const row = { ...BTC, time: 1789720800000, open_price: 1, high_price: 4, low_price: 1 };
    expect(rows).toHaveBeenCalledExactlyOnceWith(expect.objectContaining(row), {
      kind: "price",
      channel: PRICE,
      timestamp: 1789720859999,
      data: expect.objectContaining(row),
      frame: PRICE_FRAME,
    });
    expect(entries).toHaveBeenCalledExactlyOnceWith(
      [expect.objectContaining({ exchange: "bybit", coin: "BTC", coin_open_interest_close: 2 })],
      expect.objectContaining({ kind: "aggregated_open_interest_coins", channel: OI }),
    );
    watcher.close();
  });

  it("subscribes one wire name once, decodes it once, and calls every channel listed for it", async () => {
    const decode = vi.fn((frame: ChannelFrame) => frame.d);
    const first = vi.fn();
    const second = vi.fn();
    const counted = channels.custom({ kind: "counted", name: PRICE, decode });
    const { watcher, socket, send } = await open([
      counted.on({ data: first }),
      counted.on({ data: second }),
    ]);

    send(PRICE_FRAME);

    expect(socket.sent).toEqual([`s2 ${PRICE}`]);
    expect(decode).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    watcher.close();
    expect(socket.sent).toEqual([`s2 ${PRICE}`, `u2 ${PRICE}`]);
  });

  it("reports a listener that throws and carries on: the socket, and the next listener", async () => {
    const failure = new Error("listener failure");
    const reported = vi.fn();
    const second = vi.fn();
    const price = channels.price(BTC);
    const { watcher, socket, send } = await open(
      [
        price.on({
          data: () => {
            throw failure;
          },
        }),
        price.on({ data: second }),
      ],
      { onListenerError: reported },
    );

    send(PRICE_FRAME);

    expect(reported).toHaveBeenCalledExactlyOnceWith(failure);
    expect(second).toHaveBeenCalledTimes(1);
    expect(watcher.state).toBe("open");
    expect(socket.readyState).toBe(1);
    watcher.close();
  });

  it("sends the server's refusal to that channel's error alone", async () => {
    const priceError = vi.fn();
    const oiError = vi.fn();
    const oiData = vi.fn();
    const { watcher, send } = await open([
      channels.price(BTC).on({ data: () => {}, error: priceError }),
      channels.openInterest({ coin: "BTC" }, { metric: "coins" }).on({
        data: oiData,
        error: oiError,
      }),
    ]);

    send({ u2: PRICE });
    send(OI_FRAME);

    expect(priceError).toHaveBeenCalledExactlyOnceWith({ channel: PRICE, reason: "unsubscribed" });
    expect(oiError).not.toHaveBeenCalled();
    expect(oiData).toHaveBeenCalledTimes(1);
    watcher.close();
  });

  it("reports each skipped frame as decode, then failing once, then nothing until it recovers", async () => {
    const data = vi.fn();
    const error = vi.fn();
    const { watcher, send } = await open([channels.price(BTC).on({ data, error })]);
    const bad = { ...PRICE_FRAME, d: "not a candle" };
    const reasons = () => error.mock.calls.map(([event]) => (event as { reason: string }).reason);

    for (let failure = 0; failure < MAX_CONSECUTIVE_DECODE_FAILURES + 2; failure++) send(bad);

    expect(reasons()).toEqual(["decode", "decode", "decode", "failing"]);
    expect(error).toHaveBeenNthCalledWith(1, {
      channel: PRICE,
      reason: "decode",
      error: expect.objectContaining({ message: `failed to decode channel ${PRICE}` }),
      frame: bad,
    });
    expect(error).toHaveBeenLastCalledWith({
      channel: PRICE,
      reason: "failing",
      error: expect.objectContaining({ message: `failed to decode channel ${PRICE}` }),
    });
    expect(data).not.toHaveBeenCalled();

    /* One frame that decodes clears the count: data resumes, and the next failure is reported again. */
    send(PRICE_FRAME);
    send(bad);
    expect(data).toHaveBeenCalledTimes(1);
    expect(reasons()).toEqual(["decode", "decode", "decode", "failing", "decode"]);
    watcher.close();
  });

  it("refuses a channel with no data listener, which would deliver nowhere", () => {
    expect(() => channels.feed([channels.price(BTC)])).toThrow(
      "realtime_binance-futures:BTCUSDT has no data listener; give it one with .on({ data })",
    );
    expect(() => channels.feed([channels.price(BTC).on({ error: () => {} })])).toThrow(
      "has no data listener",
    );
  });

  it("refuses a channel written by hand, pointing at custom()", () => {
    const written = { kind: "mine", name: PRICE, decode: (frame: ChannelFrame) => frame.d };

    expect(() => channels.feed([written as never])).toThrow(
      "channels must be built on the channels namespace; wrap a wire name with channels.raw(), or a decoder of your own with channels.custom()",
    );
  });
});
