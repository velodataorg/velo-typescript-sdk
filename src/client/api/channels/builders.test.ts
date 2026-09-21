import { describe, expect, expectTypeOf, it } from "vitest";

import { channels, Velo } from "../../../index.ts";
import type { ChannelFor, Coin, Target } from "../../../index.ts";
import { FakeSocket, flushConnection } from "../../../transport/fake-socket.ts";
import type { ExchangeEntry } from "../../channel/helpers/decode.ts";
import type { Row } from "../../data/row.ts";
import type { FuturesExchange } from "../../market/exchanges.ts";
import type { FuturesOpenInterestColumn } from "../futures/selectors.ts";

const BTC = { exchange: "binance-futures", coin: "BTC", product: "BTCUSDT" } as const;

/*
 * What a feed does with channels, such as subscribing a repeat once and
 * skipping a frame it cannot decode, is the feed's to test. This is the one
 * thing only the builders can show: that each one's listener gets that
 * builder's own data, a row for a product and entries for a coin.
 */
describe("channel builders in a feed", () => {
  it("gives each builder's listener its own data, a row for a product and entries for a coin", async () => {
    const sockets: FakeSocket[] = [];
    const client = new Velo({
      apiKey: "key",
      webSocketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    });
    const seen: [string, number | null][] = [];
    const feed = channels.feed([
      channels.price(BTC).on({
        data: (row, message) => {
          expectTypeOf(message.kind).toEqualTypeOf<"price">();
          seen.push([message.kind, row.close_price]);
        },
      }),
      channels.openInterest(BTC, { metric: "coins" }).on({
        data: (row, message) => {
          expectTypeOf(row).toEqualTypeOf<
            Row<FuturesExchange, FuturesOpenInterestColumn<"coin">>
          >();
          seen.push([message.kind, row.coin_open_interest_close]);
        },
      }),
      channels.openInterest({ coin: "BTC" }, { metric: "coins" }).on({
        data: (entries, message) => {
          expectTypeOf(entries).toEqualTypeOf<
            readonly ExchangeEntry<FuturesExchange, FuturesOpenInterestColumn<"coin">>[]
          >();
          seen.push([message.kind, entries.length]);
          /* An entry has no time; the frame's tick time is still there for a caller who buckets. */
          expect(message.timestamp).toBe(1789720859999);
        },
      }),
      channels.fundingRate({ coin: "BTC" }, { weighted: true }).on({
        data: (entries, message) => {
          expectTypeOf(entries).toEqualTypeOf<
            readonly ExchangeEntry<FuturesExchange, "funding_rate" | "coin_open_interest_close">[]
          >();
          seen.push([message.kind, entries[0]?.coin_open_interest_close ?? null]);
        },
      }),
    ]);
    const pending = client.watch(feed);
    await flushConnection();
    sockets[0]!.open();
    const watcher = await pending;

    const send = (frame: object) => sockets[0]!.message(JSON.stringify(frame));
    send({ c: "realtime_binance-futures:BTCUSDT", d: [1, 4, 1, 3, 10, 30], tt: 1789720859999 });
    send({
      c: "realtime_binance-futures:BTCUSDT#open_interest#Coins",
      d: [108224.37, 108212.476, 108224.08],
      tt: 1789720859999,
    });
    send({
      c: "realtime_BTC#open_interest#Coins#Aggregated",
      d: { realtime_bybit: [3, 1, 2], realtime_deribit: [6, 4, 5] },
      tt: 1789720859999,
    });
    send({
      c: "realtime_BTC#funding_rate#Rate (%)#weighted#Aggregated",
      d: { realtime_deribit: [0.0000325, 9993.0863] },
      tt: 1789720859999,
    });

    expect(sockets[0]!.sent).toEqual([
      "s2 realtime_binance-futures:BTCUSDT",
      "s2 realtime_binance-futures:BTCUSDT#open_interest#Coins",
      "s2 realtime_BTC#open_interest#Coins#Aggregated",
      "s2 realtime_BTC#funding_rate#Rate (%)#weighted#Aggregated",
    ]);
    expect(seen).toEqual([
      ["price", 3],
      ["open_interest_coins", 108224.08],
      ["aggregated_open_interest_coins", 2],
      ["aggregated_funding_rate_weighted", 9993.0863],
    ]);
    watcher.close();
  });

  it("lets a caller write a function over any target, in the types the package exports", () => {
    const follow = <T extends Target<FuturesExchange>>(target: T) => channels.tape(target);
    const coin: Coin = { coin: "BTC" };

    expectTypeOf(follow(BTC).kind).toEqualTypeOf<"tape">();
    expectTypeOf(follow(coin).kind).toEqualTypeOf<"aggregated_tape">();
    /* What such a function returns has a name, so a caller's own declarations can say it. */
    type Tape<T> = ChannelFor<
      T,
      FuturesExchange,
      { kind: "tape"; suffix: string; columns: readonly ["buy_trades", "sell_trades"] }
    >;
    expectTypeOf(follow(BTC)).toEqualTypeOf<Tape<typeof BTC>>();
    expectTypeOf(follow(coin)).toEqualTypeOf<Tape<Coin>>();
    expect(follow(coin).name).toBe("realtime_BTC#tape#Trade Count#Aggregated");
  });
});
