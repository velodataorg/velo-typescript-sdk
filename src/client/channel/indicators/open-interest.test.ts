import { describe, expect, expectTypeOf, it } from "vitest";

import { channel, channels, Velo, VeloError } from "../../../index.ts";
import { FakeSocket, flushConnection } from "../../../transport/fake-socket.ts";
import type { FutureProduct } from "../../api/catalog/futures.ts";
import type { FuturesOpenInterestColumn } from "../../api/futures/selectors.ts";
import type { Row } from "../../data/row.ts";
import type { FuturesExchange } from "../../market/exchanges.ts";
import type { ExchangeEntry } from "../helpers/decode.ts";

const BTC = { exchange: "binance-futures", coin: "BTC", product: "BTCUSDT" } as const;
const COINS = "realtime_binance-futures:BTCUSDT#open_interest#Coins";
const DOLLARS = "realtime_binance-futures:BTCUSDT#open_interest#Dollars";

/* Frames captured live on 2026-09-18 around the 08:41:00 UTC rollover. */
const LAST_OF_MINUTE = {
  c: COINS,
  d: [108224.37, 108212.476, 108224.08],
  f: false,
  tt: 1789720859999,
};
const ROLLOVER = {
  c: COINS,
  d: [108224.08, 108224.08, 108224.08],
  f: true,
  tt: 1789720860000,
};
/*
 * The last dollar payload of the 09:00:00 UTC minute, captured the same day.
 * Its tick time was not recorded; any instant inside the minute decodes alike.
 */
const DOLLARS_LAST_OF_MINUTE = {
  c: DOLLARS,
  d: [8448574682.641, 8442044698.981, 8445349240.2669],
  tt: 1789722059999,
};

describe("channel.openInterest", () => {
  it("names one channel per metric, defaulting to dollars as history does", () => {
    const dollars = channel.openInterest(BTC);
    const coins = channel.openInterest(BTC, { metric: "coins" });

    expect([dollars.kind, dollars.name]).toEqual(["open_interest_dollars", DOLLARS]);
    expect([coins.kind, coins.name]).toEqual(["open_interest_coins", COINS]);
    expect(channel.openInterest(BTC, { metric: "dollars" }).name).toBe(DOLLARS);
    expect(Object.keys(coins).sort()).toEqual(["decode", "kind", "name"]);
    expect(Object.isFrozen(coins)).toBe(true);
  });

  it("accepts catalog products as returned, including namespaced symbols", () => {
    const listed: FutureProduct = { ...BTC, begin: 0, depth: true };
    expect(channel.openInterest(listed, { metric: "coins" }).decode(LAST_OF_MINUTE)).toMatchObject(
      BTC,
    );
    expect(
      channel.openInterest(
        { exchange: "hyperliquid", coin: "AAPL", product: "xyz:AAPL" },
        { metric: "coins" },
      ).name,
    ).toBe("realtime_hyperliquid:xyz:AAPL#open_interest#Coins");
  });

  it("decodes a coin frame to the history row of its minute", () => {
    const coins = channel.openInterest(BTC, { metric: "coins" });

    /* These are the values /api/v1/rows returned for the same minute. */
    expect(coins.decode(LAST_OF_MINUTE)).toEqual({
      exchange: "binance-futures",
      coin: "BTC",
      product: "BTCUSDT",
      time: 1789720800000,
      coin_open_interest_high: 108224.37,
      coin_open_interest_low: 108212.476,
      coin_open_interest_close: 108224.08,
    });
    /* The new candle opens at the previous close. */
    expect(coins.decode(ROLLOVER)).toEqual({
      exchange: "binance-futures",
      coin: "BTC",
      product: "BTCUSDT",
      time: 1789720860000,
      coin_open_interest_high: 108224.08,
      coin_open_interest_low: 108224.08,
      coin_open_interest_close: 108224.08,
    });
  });

  it("decodes a dollar frame to the dollar columns, close valued at the last trade", () => {
    const row = channel.openInterest(BTC).decode(DOLLARS_LAST_OF_MINUTE);

    expect(row).toEqual({
      exchange: "binance-futures",
      coin: "BTC",
      product: "BTCUSDT",
      time: 1789722000000,
      dollar_open_interest_high: 8448574682.641,
      dollar_open_interest_low: 8442044698.981,
      dollar_open_interest_close: 8445349240.2669,
    });
    /*
     * /api/v1/rows returned the same high and low for that minute but a close
     * of 8446523511.398, valued at the mark price of the last update instead.
     */
    expect(row.dollar_open_interest_close).not.toBe(8446523511.398);
  });

  it.each([
    { ...LAST_OF_MINUTE, d: [1, 2] },
    { ...LAST_OF_MINUTE, d: [1, 2, "3"] },
    { ...LAST_OF_MINUTE, d: [1, 2, null] },
    { ...LAST_OF_MINUTE, d: 3 },
    { ...LAST_OF_MINUTE, tt: undefined },
    { c: COINS },
  ])("rejects a malformed frame: %j", (frame) => {
    const coins = channel.openInterest(BTC, { metric: "coins" });
    expect(() => coins.decode(frame as never)).toThrow(VeloError);
    expect(() => coins.decode(frame as never)).toThrow(/unexpected realtime_binance-futures/);
  });

  it.each([
    null,
    { ...BTC, exchange: "binance" },
    { ...BTC, exchange: "deribit-options" },
    { ...BTC, coin: "" },
    { ...BTC, product: "BTC\nUSDT" },
  ])("accepts only futures products: %j", (product) => {
    expect(() => channel.openInterest(product as never)).toThrow(VeloError);
    expect(() => channel.openInterest(product as never, { metric: "coins" })).toThrow(VeloError);
  });

  it.each([
    { metric: "contracts" },
    { metric: "coin" },
    { metric: "Coins" },
    { metric: true },
    { metrics: "coins" },
    { aggregated: true },
    "coins",
    ["coins"],
    null,
  ])("rejects unusable options: %j", (options) => {
    const untyped = channel.openInterest as (target: unknown, options: unknown) => unknown;
    expect(() => untyped(BTC, options)).toThrow(VeloError);
  });

  it("rejects an unknown metric and an unusable target at compile time too", () => {
    // @ts-expect-error contracts is not a metric
    expect(() => channel.openInterest(BTC, { metric: "contracts" })).toThrow(
      'channel.openInterest() received an unknown metric "contracts"; expected coins, dollars',
    );
    // @ts-expect-error the target says what to follow; no option does
    expect(() => channel.openInterest(BTC, { aggregated: true })).toThrow(
      'channel.openInterest() received an unknown option "aggregated"; expected metric',
    );
    // @ts-expect-error a coin is written { coin }
    expect(() => channel.openInterest("BTC")).toThrow(
      'channel.openInterest() takes a product, as the catalog returns it, or a coin, such as { coin: "BTC" }',
    );
    // @ts-expect-error a coin names no exchange, and a product names all three fields
    expect(() => channel.openInterest({ exchange: "bybit", coin: "BTC" })).toThrow(
      "channel.openInterest() takes a product whose product is a non-empty string",
    );
  });

  describe("aggregated", () => {
    const AGGREGATE_COINS = "realtime_BTC#open_interest#Coins#Aggregated";
    /* Captured live on 2026-09-18, the last frame stamped inside the 08:40 UTC minute. */
    const AGGREGATE_FRAME = {
      c: AGGREGATE_COINS,
      tt: 1789720859999,
      f: false,
      d: {
        "realtime_okex-coin-margin": [6472.295509088199, 6472.287193928873, 6472.295509088199],
        realtime_deribit: [10047.403354814322, 10047.393033880415, 10047.403354814322],
        realtime_hyperliquid: [35795.213, 35792.9317, 35792.9317],
        "realtime_binance-coin-margin": [16092.303580904072, 16091.571898856373, 16092.29330239502],
        "realtime_bybit-coin-margin": [6040.641720850145, 6040.641720850145, 6040.641720850145],
        realtime_bybit: [56289.734, 56283.748, 56284.329],
        "realtime_binance-futures": [108224.08, 108224.08, 108224.08],
        "realtime_okex-swap": [28585.509100000178, 28585.509100000178, 28585.509100000178],
      },
    };

    it("follows a coin under the aggregate kind and the aggregated name", () => {
      const coins = channel.openInterest({ coin: "BTC" }, { metric: "coins" });
      const dollars = channel.openInterest({ coin: "BTC" });

      expectTypeOf(coins.kind).toEqualTypeOf<"aggregated_open_interest_coins">();
      expectTypeOf(dollars.kind).toEqualTypeOf<"aggregated_open_interest_dollars">();
      expect([coins.kind, coins.name]).toEqual(["aggregated_open_interest_coins", AGGREGATE_COINS]);
      expect([dollars.kind, dollars.name]).toEqual([
        "aggregated_open_interest_dollars",
        "realtime_BTC#open_interest#Dollars#Aggregated",
      ]);
      expect(Object.keys(coins).sort()).toEqual(["decode", "kind", "name"]);
      expect(Object.isFrozen(coins)).toBe(true);
      /* Coin symbols are not limited to ASCII, and the server accepts them as they are. */
      expect(channel.openInterest({ coin: "币安人生" }).name).toBe(
        "realtime_币安人生#open_interest#Dollars#Aggregated",
      );
    });

    it("decodes a frame to one entry per exchange, in the product columns, without a time", () => {
      const coins = channel.openInterest({ coin: "BTC" }, { metric: "coins" });
      const entries = coins.decode(AGGREGATE_FRAME);

      expectTypeOf(entries).toEqualTypeOf<
        readonly ExchangeEntry<FuturesExchange, FuturesOpenInterestColumn<"coin">>[]
      >();
      expect(entries).toHaveLength(8);
      expect(entries.find((entry) => entry.exchange === "bybit")).toEqual({
        exchange: "bybit",
        coin: "BTC",
        coin_open_interest_high: 56289.734,
        coin_open_interest_low: 56283.748,
        coin_open_interest_close: 56284.329,
      });
      /* Close is each exchange's current value, so the total is exact. */
      const total = entries.reduce((sum, entry) => sum + (entry.coin_open_interest_close ?? 0), 0);
      expect(total).toBeCloseTo(267539.4837, 4);
    });

    it("carries only the exchanges a coin trades on, and skips one it does not know", () => {
      const coins = channel.openInterest({ coin: "0G" }, { metric: "coins" });
      const entries = coins.decode({
        c: coins.name,
        d: {
          "realtime_binance-futures": [3, 1, 2],
          realtime_bybit: [6, 4, 5],
          "realtime_exchange-added-later": [9, 9, 9],
        },
      });
      expect(entries.map((entry) => [entry.exchange, entry.coin_open_interest_close])).toEqual([
        ["binance-futures", 2],
        ["bybit", 5],
      ]);
    });

    it.each([
      { d: { realtime_bybit: [1, 2] } },
      { d: { realtime_bybit: [1, 2, null] } },
      { d: [1, 2, 3] },
      {},
    ])("rejects a malformed frame: %j", (frame) => {
      const coins = channel.openInterest({ coin: "BTC" }, { metric: "coins" });
      expect(() => coins.decode({ c: coins.name, ...frame } as never)).toThrow(VeloError);
      expect(() => coins.decode({ c: coins.name, ...frame } as never)).toThrow(
        /unexpected realtime_BTC#open_interest#Coins#Aggregated/,
      );
    });

    it("rides a feed beside the product channel, narrowed apart by kind", async () => {
      const sockets: FakeSocket[] = [];
      const client = new Velo({
        apiKey: "key",
        webSocketFactory: () => {
          const socket = new FakeSocket();
          sockets.push(socket);
          return socket;
        },
      });
      const seen: [string, number][] = [];
      const feed = channels.feed([
        channel.openInterest(BTC, { metric: "coins" }),
        channel.openInterest({ coin: "BTC" }, { metric: "coins" }),
        channel.openInterest({ coin: "BTC" }, { metric: "coins" }),
      ]);
      const pending = client.watch(feed, {
        on: {
          data: (event) => {
            expectTypeOf(event.kind).toEqualTypeOf<
              "open_interest_coins" | "aggregated_open_interest_coins"
            >();
            if (event.kind === "aggregated_open_interest_coins") {
              expectTypeOf(event.data).toEqualTypeOf<
                readonly ExchangeEntry<FuturesExchange, FuturesOpenInterestColumn<"coin">>[]
              >();
              seen.push([event.kind, event.data.length]);
              /* The frame's tick time is still there for a caller who buckets. */
              expect(event.timestamp).toBe(1789720859999);
            } else {
              expectTypeOf(event.data).toEqualTypeOf<
                Row<FuturesExchange, FuturesOpenInterestColumn<"coin">>
              >();
              seen.push([event.kind, event.data.time]);
            }
          },
        },
      });
      await flushConnection();
      sockets[0]!.open();
      const watcher = await pending;

      sockets[0]!.message(JSON.stringify(LAST_OF_MINUTE));
      sockets[0]!.message(JSON.stringify(AGGREGATE_FRAME));

      /* The repeated aggregate collapsed; it is one subscription whatever it spans. */
      expect(sockets[0]!.sent).toEqual([`s2 ${COINS}`, `s2 ${AGGREGATE_COINS}`]);
      expect(seen).toEqual([
        ["open_interest_coins", 1789720800000],
        ["aggregated_open_interest_coins", 8],
      ]);
      watcher.close();
    });

    it.each(["BTC", null, 42, [], {}, { coin: "" }, { coin: 42 }, { coins: ["BTC"] }])(
      "follows only a coin that names its symbol: %j",
      (coin) => {
        const untyped = channel.openInterest as (target: unknown) => unknown;
        expect(() => untyped(coin)).toThrow(VeloError);
      },
    );

    it("reads a target naming an exchange or a product as a product, never as its coin", () => {
      const untyped = channel.openInterest as (target: unknown) => { readonly kind: string };
      /* A product missing a field is refused rather than followed across every exchange. */
      expect(() => untyped({ exchange: "bybit", coin: "BTC" })).toThrow(VeloError);
      expect(() => untyped({ coin: "BTC", product: "BTCUSDT" })).toThrow(VeloError);
      expect(untyped({ coin: "BTC" }).kind).toBe("aggregated_open_interest_dollars");
      /* Fields a coin does not have are dropped, as a catalog row's are for a product. */
      expect(untyped({ coin: "BTC", begin: 0 }).kind).toBe("aggregated_open_interest_dollars");
    });
  });

  it("carries both metrics of one product in a feed and narrows rows by kind", async () => {
    const sockets: FakeSocket[] = [];
    const client = new Velo({
      apiKey: "key",
      webSocketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    });
    const closes: [string, number | null][] = [];
    const feed = channels.feed([
      channel.openInterest(BTC, { metric: "coins" }),
      channel.openInterest(BTC, { metric: "coins" }),
      channel.openInterest(BTC),
      channel.price(BTC),
    ]);
    const pending = client.watch(feed, {
      on: {
        data: (event) => {
          expectTypeOf(event.kind).toEqualTypeOf<
            "open_interest_coins" | "open_interest_dollars" | "price"
          >();
          if (event.kind === "open_interest_coins") {
            expectTypeOf(event.data).toEqualTypeOf<
              Row<FuturesExchange, FuturesOpenInterestColumn<"coin">>
            >();
            closes.push([event.kind, event.data.coin_open_interest_close]);
          } else if (event.kind === "open_interest_dollars") {
            expectTypeOf(event.data).toEqualTypeOf<
              Row<FuturesExchange, FuturesOpenInterestColumn<"dollar">>
            >();
            closes.push([event.kind, event.data.dollar_open_interest_close]);
          }
        },
      },
    });
    await flushConnection();
    sockets[0]!.open();
    const watcher = await pending;

    sockets[0]!.message(JSON.stringify(LAST_OF_MINUTE));
    sockets[0]!.message(JSON.stringify(DOLLARS_LAST_OF_MINUTE));

    /* The repeated coin channel collapsed; the two metrics are separate wire names. */
    expect(sockets[0]!.sent).toEqual([
      `s2 ${COINS}`,
      `s2 ${DOLLARS}`,
      "s2 realtime_binance-futures:BTCUSDT",
    ]);
    expect(closes).toEqual([
      ["open_interest_coins", 108224.08],
      ["open_interest_dollars", 8445349240.2669],
    ]);
    watcher.close();
  });
});
