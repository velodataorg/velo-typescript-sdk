import { describe, expect, expectTypeOf, it } from "vitest";

import { channel, channels, Velo, VeloError } from "../../../index.ts";
import { FakeSocket, flushConnection } from "../../../transport/fake-socket.ts";
import type { FutureProduct } from "../../api/catalog/futures.ts";
import type { FuturesOpenInterestColumn } from "../../api/futures/selectors.ts";
import type { Row } from "../../data/row.ts";
import type { FuturesExchange } from "../../market/exchanges.ts";

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
    const coins = channel.openInterest(BTC, { metric: "coin" });

    expect([dollars.kind, dollars.name]).toEqual(["open_interest_dollar", DOLLARS]);
    expect([coins.kind, coins.name]).toEqual(["open_interest_coin", COINS]);
    expect(channel.openInterest(BTC, { metric: "dollar" }).name).toBe(DOLLARS);
    expect(Object.keys(coins).sort()).toEqual(["decode", "kind", "name"]);
    expect(Object.isFrozen(coins)).toBe(true);
  });

  it("accepts catalog products as returned, including namespaced symbols", () => {
    const listed: FutureProduct = { ...BTC, begin: 0, depth: true };
    expect(channel.openInterest(listed, { metric: "coin" }).decode(LAST_OF_MINUTE)).toMatchObject(
      BTC,
    );
    expect(
      channel.openInterest(
        { exchange: "hyperliquid", coin: "AAPL", product: "xyz:AAPL" },
        { metric: "coin" },
      ).name,
    ).toBe("realtime_hyperliquid:xyz:AAPL#open_interest#Coins");
  });

  it("decodes a coin frame to the history row of its minute", () => {
    const coins = channel.openInterest(BTC, { metric: "coin" });

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
    const coins = channel.openInterest(BTC, { metric: "coin" });
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
    expect(() => channel.openInterest(product as never, { metric: "coin" })).toThrow(VeloError);
  });

  it.each([{ metric: "contracts" }, { metric: "Coins" }, "coin", ["coin"], null])(
    "rejects unusable options: %j",
    (options) => {
      expect(() => channel.openInterest(BTC, options as never)).toThrow(VeloError);
    },
  );

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
      channel.openInterest(BTC, { metric: "coin" }),
      channel.openInterest(BTC, { metric: "coin" }),
      channel.openInterest(BTC),
      channel.price(BTC),
    ]);
    const pending = client.watch(feed, {
      on: {
        data: (event) => {
          expectTypeOf(event.kind).toEqualTypeOf<
            "open_interest_coin" | "open_interest_dollar" | "price"
          >();
          if (event.kind === "open_interest_coin") {
            expectTypeOf(event.data).toEqualTypeOf<
              Row<FuturesExchange, FuturesOpenInterestColumn<"coin">>
            >();
            closes.push([event.kind, event.data.coin_open_interest_close]);
          } else if (event.kind === "open_interest_dollar") {
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
      ["open_interest_coin", 108224.08],
      ["open_interest_dollar", 8445349240.2669],
    ]);
    watcher.close();
  });
});
