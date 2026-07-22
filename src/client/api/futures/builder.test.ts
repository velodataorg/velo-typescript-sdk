import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { VeloError } from "../../../errors.js";
import { Velo } from "../../client.js";
import type { Data } from "../../common/data/data.js";
import { FUTURES_STANDARD_COLUMNS } from "../../common/market/columns.js";
import { FUTURES_EXCHANGES, type FuturesExchange } from "../../common/market/exchanges.js";
import type { FuturesBuilder, LastDuration } from "./builder.js";

function client(body = "", urls: string[] = []) {
  const fetch: typeof globalThis.fetch = async (input) => {
    urls.push(String(input));
    return new Response(body);
  };
  return { velo: new Velo({ apiKey: "test_key", fetch }), urls };
}

function search(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

describe("futures fluent builder", () => {
  const begin = Date.UTC(2026, 6, 13, 8);
  const end = Date.UTC(2026, 6, 13, 10);

  it("keeps builder terminal methods off the futures namespace", () => {
    const { futures } = client().velo;

    expect(futures).not.toHaveProperty("params");
    expect(futures).not.toHaveProperty("build");
    expect(futures).not.toHaveProperty("execute");
  });

  it("exposes every selector as a futures namespace entry point", () => {
    const { futures } = client().velo;
    const selectors = [
      "price",
      "volume",
      "trades",
      "openInterest",
      "fundingRate",
      "premium",
      "liquidations",
      "liquidationVolume",
    ] as const;

    for (const selector of selectors) {
      expect(futures[selector]).toBeTypeOf("function");
    }
  });

  it("accumulates typed columns, deduplicates them, and preserves insertion order", () => {
    const { velo } = client();
    const builder = velo.futures
      .price("close", "open")
      .price("open", "high")
      .openInterest("close")
      .openInterest("high")
      .openInterest("low", { metric: "coin" })
      .products(["BTCUSDT"])
      .between(begin, end)
      .resolution("1h");

    expect(builder.params().columns).toEqual([
      "close_price",
      "open_price",
      "high_price",
      "dollar_open_interest_close",
      "dollar_open_interest_high",
      "coin_open_interest_low",
    ]);
    expectTypeOf(builder).toEqualTypeOf<
      FuturesBuilder<
        | "close_price"
        | "open_price"
        | "high_price"
        | "dollar_open_interest_close"
        | "dollar_open_interest_high"
        | "coin_open_interest_low"
      >
    >();
  });

  it("defaults to every futures exchange and accepts an explicit replacement", () => {
    const { velo } = client();
    const base = velo.futures
      .price("close")
      .products(["BTCUSDT"])
      .between(begin, end)
      .resolution("1h");

    expect(base.params().exchanges).toEqual(FUTURES_EXCHANGES);
    expect(base.exchanges(["bybit"]).params().exchanges).toEqual(["bybit"]);
  });

  it("defaults to every price column when no parts are provided", () => {
    const builder = client()
      .velo.futures.price()
      .products(["BTCUSDT"])
      .between(begin, end)
      .resolution("1h");

    expect(builder.params().columns).toEqual([
      "open_price",
      "high_price",
      "low_price",
      "close_price",
    ]);
    expectTypeOf(builder).toEqualTypeOf<
      FuturesBuilder<"open_price" | "high_price" | "low_price" | "close_price">
    >();
  });

  it("defaults to every dollar open-interest part when no parts are provided", () => {
    const builder = client()
      .velo.futures.openInterest()
      .products(["BTCUSDT"])
      .between(begin, end)
      .resolution("1h");

    expect(builder.params().columns).toEqual([
      "dollar_open_interest_high",
      "dollar_open_interest_low",
      "dollar_open_interest_close",
    ]);
    expectTypeOf(builder).toEqualTypeOf<
      FuturesBuilder<
        "dollar_open_interest_high" | "dollar_open_interest_low" | "dollar_open_interest_close"
      >
    >();
  });

  it("applies an explicit open-interest metric to every omitted part", () => {
    const builder = client()
      .velo.futures.openInterest(undefined, { metric: "coin" })
      .products(["BTCUSDT"])
      .between(begin, end)
      .resolution("1h");

    expect(builder.params().columns).toEqual([
      "coin_open_interest_high",
      "coin_open_interest_low",
      "coin_open_interest_close",
    ]);
    expectTypeOf(builder).toEqualTypeOf<
      FuturesBuilder<
        "coin_open_interest_high" | "coin_open_interest_low" | "coin_open_interest_close"
      >
    >();
  });

  it("maps the remaining selectors to exact accumulated column types", () => {
    const builder = client()
      .velo.futures.volume("buy", { metric: "coin" })
      .trades("sell")
      .fundingRate("average")
      .premium()
      .liquidations("buy")
      .liquidationVolume("total", { metric: "dollar" })
      .products(["BTCUSDT"])
      .between(begin, end)
      .resolution("1h");

    expect(builder.params().columns).toEqual([
      "buy_coin_volume",
      "sell_trades",
      "funding_rate_avg",
      "premium",
      "buy_liquidations",
      "liquidations_dollar_volume",
    ]);
    expectTypeOf(builder).toEqualTypeOf<
      FuturesBuilder<
        | "buy_coin_volume"
        | "sell_trades"
        | "funding_rate_avg"
        | "premium"
        | "buy_liquidations"
        | "liquidations_dollar_volume"
      >
    >();
  });

  it("makes every standard futures column reachable through fluent selectors", () => {
    const columns = client()
      .velo.futures.price()
      .volume()
      .volume(undefined, { metric: "coin" })
      .trades()
      .openInterest()
      .openInterest(undefined, { metric: "coin" })
      .fundingRate()
      .premium()
      .liquidations()
      .liquidationVolume()
      .liquidationVolume(undefined, { metric: "coin" })
      .products(["BTCUSDT"])
      .between(begin, end)
      .resolution("1h")
      .params().columns;

    expect(columns).toHaveLength(FUTURES_STANDARD_COLUMNS.length);
    expect(new Set(columns)).toEqual(new Set(FUTURES_STANDARD_COLUMNS));
  });

  it("snapshots caller-owned arrays and dates", () => {
    const { velo } = client();
    const exchanges: FuturesExchange[] = ["bybit"];
    const products = ["BTCUSDT"];
    const rangeBegin = new Date(begin);
    const rangeEnd = new Date(end);
    const builder = velo.futures
      .price("close")
      .exchanges(exchanges)
      .products(products)
      .between(rangeBegin, rangeEnd)
      .resolution("1h");

    exchanges.push("deribit");
    products[0] = "ETHUSDT";
    rangeBegin.setTime(begin + 60_000);
    rangeEnd.setTime(end + 60_000);

    const first = builder.params();
    expect(first).toMatchObject({
      exchanges: ["bybit"],
      products: ["BTCUSDT"],
      begin,
      end,
    });

    (first.exchanges as FuturesExchange[]).push("deribit");
    (first.products as string[]).push("ETHUSDT");
    expect(builder.params()).toMatchObject({
      exchanges: ["bybit"],
      products: ["BTCUSDT"],
    });
  });

  it("supports immutable branching", () => {
    const { velo } = client();
    const base = velo.futures.products(["BTCUSDT"]).between(begin, end).resolution("1h");
    const prices = base.price("open");
    const interest = base.openInterest("close");

    expect(prices.params().columns).toEqual(["open_price"]);
    expect(interest.params().columns).toEqual(["dollar_open_interest_close"]);
  });

  it("rejects conflicting selectors and malformed eager inputs", () => {
    const { velo } = client();
    expect(() => velo.futures.products(["BTCUSDT"]).coins(["BTC"])).toThrow(VeloError);
    expect(() => velo.futures.coins(["BTC"]).products(["BTCUSDT"])).toThrow(VeloError);
    expect(() => velo.futures.last("0m")).toThrow(VeloError);
    expect(() => velo.futures.last("1d" as LastDuration)).toThrow(VeloError);
  });

  it("uses the existing schema for incomplete chains", () => {
    const { velo } = client();
    const incomplete = [
      () => velo.futures.products(["BTCUSDT"]).between(begin, end).resolution("1h").params(),
      () => velo.futures.price("close").between(begin, end).resolution("1h").params(),
      () => velo.futures.price("close").products(["BTCUSDT"]).resolution("1h").params(),
    ];

    for (const lower of incomplete) {
      expect(lower).toThrow(VeloError);
      expect(lower).toThrow(/Invalid futures params/);
    }
  });

  it("reads the clock for each lowering but fixes it in a built query", async () => {
    vi.useFakeTimers();
    try {
      const urls: string[] = [];
      const { velo } = client("exchange,coin,product,time,open_price\n", urls);
      const builder = velo.futures.price("open").products(["BTCUSDT"]).last("11m").resolution("1m");
      const firstEnd = Date.UTC(2026, 6, 13, 10);
      const secondEnd = firstEnd + 5 * 60_000;

      vi.setSystemTime(firstEnd);
      expect(builder.params()).toMatchObject({ begin: firstEnd - 11 * 60_000, end: firstEnd });
      vi.setSystemTime(secondEnd);
      expect(builder.params()).toMatchObject({ begin: secondEnd - 11 * 60_000, end: secondEnd });

      vi.setSystemTime(firstEnd);
      await builder.execute();
      vi.setSystemTime(secondEnd);
      await builder.execute();
      expect(search(urls[0]!).get("end")).toBe(String(firstEnd));
      expect(search(urls[1]!).get("end")).toBe(String(secondEnd));

      vi.setSystemTime(firstEnd);
      const query = builder.build();
      vi.setSystemTime(secondEnd);
      await query.execute();
      vi.setSystemTime(secondEnd + 5 * 60_000);
      await query.execute();
      expect(search(urls[2]!).get("end")).toBe(String(firstEnd));
      expect(search(urls[3]!).get("end")).toBe(String(firstEnd));
    } finally {
      vi.useRealTimers();
    }
  });

  it("converts compact durations with Luxon", () => {
    vi.useFakeTimers();
    try {
      const { velo } = client();
      const now = Date.UTC(2026, 6, 13, 10);
      vi.setSystemTime(now);
      const base = velo.futures.price("open").products(["BTCUSDT"]).resolution("1m");
      const durations = [
        ["2h", 2 * 60 * 60 * 1_000],
        ["3D", 3 * 24 * 60 * 60 * 1_000],
        ["2W", 2 * 7 * 24 * 60 * 60 * 1_000],
      ] as const satisfies readonly (readonly [LastDuration, number])[];

      for (const [duration, milliseconds] of durations) {
        expect(base.last(duration).params()).toMatchObject({
          begin: now - milliseconds,
          end: now,
        });
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("lowers through the existing query pipeline and decodes typed data", async () => {
    const body =
      "exchange,coin,product,time,open_price,high_price,dollar_open_interest_close\n" +
      "bybit,BTC,BTCUSDT,1783929600000,63100,63200,1000000\n";
    const { velo, urls } = client(body);
    const data = await velo.futures
      .price("open", "high")
      .openInterest("close")
      .exchanges(["bybit"])
      .products(["BTCUSDT"])
      .between(begin, end)
      .resolution("1h")
      .execute();

    expect(data.rows()).toEqual([
      {
        exchange: "bybit",
        coin: "BTC",
        product: "BTCUSDT",
        time: 1783929600000,
        open_price: 63_100,
        high_price: 63_200,
        dollar_open_interest_close: 1_000_000,
      },
    ]);
    expectTypeOf(data).toEqualTypeOf<
      Data<FuturesExchange, "open_price" | "high_price" | "dollar_open_interest_close">
    >();

    const sent = search(urls[0]!);
    expect(sent.get("type")).toBe("futures");
    expect(sent.get("exchanges")).toBe("bybit");
    expect(sent.get("products")).toBe("BTCUSDT");
    expect(sent.get("coins")).toBeNull();
    expect(sent.get("columns")).toBe("open_price,high_price,dollar_open_interest_close");
    expect(sent.get("begin")).toBe(String(begin));
    expect(sent.get("end")).toBe(String(end));
    expect(sent.get("resolution")).toBe("60");
  });

  it("does not expose terminals on the untouched namespace type", () => {
    const { velo } = client();
    type NamespaceTerminal = Extract<keyof typeof velo.futures, "params" | "build" | "execute">;
    expectTypeOf<NamespaceTerminal>().toEqualTypeOf<never>();
  });
});
