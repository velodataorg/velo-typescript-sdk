import { describe, expect, expectTypeOf, it } from "vitest";

import { channel, channels, Velo } from "../../index.ts";
import type { ChannelFor, Coin, Target } from "../../index.ts";
import { FakeSocket, flushConnection } from "../../transport/fake-socket.ts";
import type { FuturesOpenInterestColumn } from "../api/futures/selectors.ts";
import type { Row } from "../data/row.ts";
import type { FuturesExchange } from "../market/exchanges.ts";
import type { ExchangeEntry } from "./helpers/decode.ts";

const BTC = { exchange: "binance-futures", coin: "BTC", product: "BTCUSDT" } as const;

/*
 * What a feed does with channels, such as collapsing repeats and skipping a
 * frame it cannot decode, is the feed's to test. This is the one thing only
 * the builders can show: that their types survive a feed, so a listener
 * narrows `data` on `kind`, to a row for a product and to entries for a coin.
 */
describe("channel builders in a feed", () => {
  it("narrows each builder's data by kind, a row for a product and entries for a coin", async () => {
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
      channel.price(BTC),
      channel.openInterest(BTC, { metric: "coins" }),
      channel.openInterest({ coin: "BTC" }, { metric: "coins" }),
      channel.fundingRate({ coin: "BTC" }, { weighted: true }),
    ]);
    const pending = client.watch(feed, {
      on: {
        data: (event) => {
          expectTypeOf(event.kind).toEqualTypeOf<
            | "price"
            | "open_interest_coins"
            | "aggregated_open_interest_coins"
            | "aggregated_funding_rate_weighted"
          >();
          if (event.kind === "price") {
            seen.push([event.kind, event.data.close_price]);
          } else if (event.kind === "open_interest_coins") {
            expectTypeOf(event.data).toEqualTypeOf<
              Row<FuturesExchange, FuturesOpenInterestColumn<"coin">>
            >();
            seen.push([event.kind, event.data.coin_open_interest_close]);
          } else if (event.kind === "aggregated_open_interest_coins") {
            expectTypeOf(event.data).toEqualTypeOf<
              readonly ExchangeEntry<FuturesExchange, FuturesOpenInterestColumn<"coin">>[]
            >();
            seen.push([event.kind, event.data.length]);
            /* An entry has no time; the frame's tick time is still there for a caller who buckets. */
            expect(event.timestamp).toBe(1789720859999);
          } else {
            expectTypeOf(event.data).toEqualTypeOf<
              readonly ExchangeEntry<FuturesExchange, "funding_rate" | "coin_open_interest_close">[]
            >();
            seen.push([event.kind, event.data[0]?.coin_open_interest_close ?? null]);
          }
        },
      },
    });
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
    const follow = <T extends Target<FuturesExchange>>(target: T) => channel.tape(target);
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
