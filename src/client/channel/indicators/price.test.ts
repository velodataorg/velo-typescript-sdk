import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { channel, channels, Velo, VeloError } from "../../../index.ts";
import type { ChannelFrameError } from "../../../index.ts";
import { FakeSocket, flushConnection } from "../../../transport/fake-socket.ts";
import type { FutureProduct } from "../../api/catalog/futures.ts";
import type { Row } from "../../data/row.ts";
import type { FuturesExchange, SpotExchange } from "../../market/exchanges.ts";

const BTC = { exchange: "binance-futures", coin: "BTC", product: "BTCUSDT" } as const;
const NAME = "realtime_binance-futures:BTCUSDT";

type PriceColumn =
  | "open_price"
  | "high_price"
  | "low_price"
  | "close_price"
  | "coin_volume"
  | "dollar_volume";

/* Frames captured live on 2026-09-17 around the 10:50:00 UTC rollover. */
const LAST_OF_MINUTE = {
  c: NAME,
  d: [76250, 76299.8, 76249.9, 76269.7, 81.873, 6245352.43],
  f: false,
  tt: 1789642199999,
};
const ROLLOVER = {
  c: NAME,
  d: [76269.7, 76269.7, 76269.7, 76269.7, 0, 0],
  f: true,
  tt: 1789642200599,
};

describe("channel.price", () => {
  it("names the channel from the exchange and product, and snapshots its inputs", () => {
    const product = { exchange: "binance-futures" as const, coin: "BTC", product: "BTCUSDT" };
    const btc = channel.price(product);
    product.coin = "changed";

    expect(btc.kind).toBe("price");
    expect(btc.name).toBe(NAME);
    expect(Object.keys(btc).sort()).toEqual(["decode", "kind", "name"]);
    expect(Object.isFrozen(btc)).toBe(true);
    /* Rows keep the coin the channel was built with, not the mutated one. */
    expect(btc.decode(LAST_OF_MINUTE).coin).toBe("BTC");
  });

  it("accepts catalog products as returned, futures and spot, including namespaced symbols", () => {
    const listed: FutureProduct = { ...BTC, begin: 0, depth: true };
    expect(channel.price(listed).decode(LAST_OF_MINUTE)).toMatchObject(BTC);
    expect(channel.price({ exchange: "coinbase", coin: "BTC", product: "BTC-USD" }).name).toBe(
      "realtime_coinbase:BTC-USD",
    );
    expect(channel.price({ exchange: "hyperliquid", coin: "AAPL", product: "xyz:AAPL" }).name).toBe(
      "realtime_hyperliquid:xyz:AAPL",
    );
  });

  it("decodes a frame to the history row of its minute", () => {
    const btc = channel.price(BTC);

    /* These are the values /api/v1/rows returned for the same minute. */
    expect(btc.decode(LAST_OF_MINUTE)).toEqual({
      exchange: "binance-futures",
      coin: "BTC",
      product: "BTCUSDT",
      time: 1789642140000,
      open_price: 76250,
      high_price: 76299.8,
      low_price: 76249.9,
      close_price: 76269.7,
      coin_volume: 81.873,
      dollar_volume: 6245352.43,
    });
    expect(btc.decode(ROLLOVER)).toMatchObject({
      time: 1789642200000,
      open_price: 76269.7,
      coin_volume: 0,
    });
  });

  it.each([
    { ...LAST_OF_MINUTE, d: [1, 2, 3, 4, 5] },
    { ...LAST_OF_MINUTE, d: [1, 2, 3, 4, 5, "6"] },
    { ...LAST_OF_MINUTE, d: { open: 1 } },
    { ...LAST_OF_MINUTE, tt: undefined },
    { c: NAME },
  ])("rejects a malformed frame: %j", (frame) => {
    expect(() => channel.price(BTC).decode(frame as never)).toThrow(VeloError);
    expect(() => channel.price(BTC).decode(frame as never)).toThrow(new RegExp(NAME));
  });

  it.each([
    null,
    [],
    { ...BTC, exchange: "deribit-options" },
    { ...BTC, coin: "" },
    { ...BTC, product: "" },
    { ...BTC, product: "BTC\nUSDT" },
    { exchange: "binance-futures", product: "BTCUSDT" },
  ])("validates the params: %j", (product) => {
    expect(() => channel.price(product as never)).toThrow(VeloError);
  });

  it("delivers typed rows through a feed and dedupes repeated products", async () => {
    const sockets: FakeSocket[] = [];
    const client = new Velo({
      apiKey: "key",
      webSocketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    });
    const rows: Row<FuturesExchange | SpotExchange, PriceColumn>[] = [];
    const pending = client.watch(channels.feed([channel.price(BTC), channel.price(BTC)]), {
      on: {
        data: (event) => {
          expectTypeOf(event.kind).toEqualTypeOf<"price">();
          expectTypeOf(event.data).toEqualTypeOf<
            Row<FuturesExchange | SpotExchange, PriceColumn>
          >();
          rows.push(event.data);
        },
      },
    });
    await flushConnection();
    sockets[0]!.open();
    const watcher = await pending;

    sockets[0]!.message(JSON.stringify(LAST_OF_MINUTE));
    sockets[0]!.message(JSON.stringify(ROLLOVER));

    expect(sockets[0]!.sent).toEqual([`s2 ${NAME}`]);
    expect(rows.map((row) => [row.time, row.close_price])).toEqual([
      [1789642140000, 76269.7],
      [1789642200000, 76269.7],
    ]);
    watcher.close();
  });

  it("follows a product only, since the server publishes no price across exchanges", () => {
    // @ts-expect-error price takes a product, never a coin
    const aggregated = () => channel.price({ coin: "BTC" });
    expect(aggregated).toThrow("channel.price() received an invalid exchange undefined");
    const untyped = channel.price as (target: unknown) => unknown;
    expect(() => untyped("BTC")).toThrow(
      "channel.price() takes a product, as the catalog returns it",
    );
  });

  it("conflicts with a raw subscription to the same wire name", () => {
    expect(() => channels.feed([channel.price(BTC), channel.raw(NAME)])).toThrow(
      /conflicting channels/,
    );
  });

  it("skips a malformed frame, keeps its reason, and goes on delivering", async () => {
    const sockets: FakeSocket[] = [];
    const client = new Velo({
      apiKey: "key",
      webSocketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    });
    const frameErrors = vi.fn();
    const closePrices: number[] = [];
    const pending = client.watch(channels.feed([channel.price(BTC)]), {
      reconnect: false,
      on: {
        frameError: frameErrors,
        data: (event) => closePrices.push(event.data.close_price ?? NaN),
      },
    });
    await flushConnection();
    sockets[0]!.open();
    const watcher = await pending;

    const malformed = { c: NAME, d: [1, 2, 3], tt: 1 };
    sockets[0]!.message(JSON.stringify(malformed));
    sockets[0]!.message(JSON.stringify(LAST_OF_MINUTE));

    expect(watcher.state).toBe("open");
    expect(closePrices).toEqual([76269.7]);
    expect(frameErrors).toHaveBeenCalledTimes(1);
    const { channel: name, error, frame } = frameErrors.mock.calls[0]![0] as ChannelFrameError;
    expect(name).toBe(NAME);
    expect(frame).toEqual(malformed);
    expect(error.message).toBe(`failed to decode channel ${NAME}`);
    expect((error.cause as Error).message).toMatch(/unexpected realtime_binance-futures:BTCUSDT/);
    watcher.close();
  });
});
