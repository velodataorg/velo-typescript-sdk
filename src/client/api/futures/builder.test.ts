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
  const scope = { products: ["BTCUSDT"], between: [begin, end], resolution: "1h" } as const;

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
      .price(["close", "open"])
      .price(["open", "high"])
      .openInterest(["close"])
      .openInterest(["high"])
      .openInterest(["low"], { metric: "coin" });

    expect(builder.params(scope).columns).toEqual([
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
    const base = velo.futures.price(["close"]);

    expect(base.params(scope).exchanges).toEqual(FUTURES_EXCHANGES);
    expect(base.exchanges(["bybit"]).params(scope).exchanges).toEqual(["bybit"]);
  });

  it("defaults to every price column when no parts are provided", () => {
    const builder = client().velo.futures.price();

    expect(builder.params(scope).columns).toEqual([
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
    const builder = client().velo.futures.openInterest();

    expect(builder.params(scope).columns).toEqual([
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
    const builder = client().velo.futures.openInterest({ metric: "coin" });

    expect(builder.params(scope).columns).toEqual([
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

  it("rejects empty part selections loudly", () => {
    const { velo } = client();
    expect(() => velo.futures.price([])).toThrow(VeloError);
    expect(() => velo.futures.price([])).toThrow(/price\(\) requires a non-empty selection/);
    expect(() => velo.futures.volume([], { metric: "coin" })).toThrow(VeloError);
  });

  it("selects several parts with a metric in one call", () => {
    const { velo } = client();
    const builder = velo.futures.volume(["buy", "sell"], { metric: "coin" });

    expect(builder.params(scope).columns).toEqual(["buy_coin_volume", "sell_coin_volume"]);
    expectTypeOf(builder).toEqualTypeOf<FuturesBuilder<"buy_coin_volume" | "sell_coin_volume">>();
  });

  it("fails loudly for untyped callers using the old scalar convention", () => {
    const { velo } = client();
    expect(() => velo.futures.price("close" as never)).toThrow(
      /price\(\) takes an array of parts; wrap a single part in an array/,
    );
    expect(() => velo.futures.volume("total" as never)).toThrow(
      /volume\(\) takes a parts array or an options object/,
    );
    expect(() => velo.options.vega("coin" as never)).toThrow(/vega\(\) options must be an object/);
    expect(() => velo.futures.volume({ metric: "bogus" } as never)).toThrow(
      /volume\(\) received an unknown metric "bogus"/,
    );
    expect(() => velo.futures.price(["nope"] as never)).toThrow(
      /price\(\) received an unknown part "nope"/,
    );
  });

  it("rejects possibly-undefined selections at compile time", () => {
    const { velo } = client();
    const maybePart = undefined as "total" | undefined;
    const maybeParts = undefined as readonly ["open"] | undefined;
    const maybeMetric = undefined as { readonly metric: "coin" } | undefined;

    /* Never called: these statements pin compile-time rejections only. */
    const compileTimeOnly = () => {
      // @ts-expect-error a bare part is not a selection; wrap it in an array
      velo.futures.volume("total");
      // @ts-expect-error a possibly-undefined part must be branched on explicitly
      velo.futures.volume(maybePart);
      // @ts-expect-error a possibly-undefined parts array must be branched on explicitly
      velo.futures.price(maybeParts);
      // @ts-expect-error possibly-undefined options must be branched on explicitly
      velo.futures.volume(["total"], maybeMetric);
      // @ts-expect-error explicit undefined selects nothing; call with no arguments instead
      velo.futures.openInterest(undefined, { metric: "coin" });
    };
    void compileTimeOnly;
  });

  it("rejects incomplete scopes at compile time", () => {
    const { velo } = client();

    /* Never called: these statements pin compile-time rejections only. */
    const compileTimeOnly = () => {
      // @ts-expect-error the scope must select products or coins
      velo.futures.price(["close"]).params({ between: [begin, end], resolution: "1h" });
      // @ts-expect-error the scope must set between or last
      velo.futures.price(["close"]).params({ products: ["BTCUSDT"], resolution: "1h" });
      // @ts-expect-error the scope must set a resolution
      velo.futures.price(["close"]).params({ products: ["BTCUSDT"], between: [begin, end] });
      // @ts-expect-error the scope cannot select both products and coins
      velo.futures.price(["close"]).build({ ...scope, coins: ["BTC"] });
      // @ts-expect-error the scope cannot set both between and last
      velo.futures.price(["close"]).execute({ ...scope, last: "10m" });
      // @ts-expect-error a terminal method requires a scope
      velo.futures.price(["close"]).execute();
    };
    void compileTimeOnly;
  });

  it("maps the remaining selectors to exact accumulated column types", () => {
    const builder = client()
      .velo.futures.volume(["buy"], { metric: "coin" })
      .trades(["sell"])
      .fundingRate(["average"])
      .premium()
      .liquidations(["buy"])
      .liquidationVolume(["total"], { metric: "dollar" });

    expect(builder.params(scope).columns).toEqual([
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
      .volume({ metric: "coin" })
      .trades()
      .openInterest()
      .openInterest({ metric: "coin" })
      .fundingRate()
      .premium()
      .liquidations()
      .liquidationVolume()
      .liquidationVolume({ metric: "coin" })
      .params(scope).columns;

    expect(columns).toHaveLength(FUTURES_STANDARD_COLUMNS.length);
    expect(new Set(columns)).toEqual(new Set(FUTURES_STANDARD_COLUMNS));
  });

  it("snapshots chain arrays, lowers the scope per call, and returns fresh copies", () => {
    const { velo } = client();
    const exchanges: FuturesExchange[] = ["bybit"];
    const products = ["BTCUSDT"];
    const builder = velo.futures.price(["close"]).exchanges(exchanges);
    const liveScope = { products, between: [begin, end], resolution: "1h" } as const;

    exchanges.push("deribit");

    const first = builder.params(liveScope);
    expect(first).toMatchObject({
      exchanges: ["bybit"],
      products: ["BTCUSDT"],
      begin,
      end,
    });

    (first.exchanges as FuturesExchange[]).push("deribit");
    (first.products as string[]).push("ETHUSDT");
    expect(builder.params(liveScope)).toMatchObject({
      exchanges: ["bybit"],
      products: ["BTCUSDT"],
    });

    products[0] = "ETHUSDT";
    expect(builder.params(liveScope).products).toEqual(["ETHUSDT"]);
  });

  it("supports immutable branching", () => {
    const { velo } = client();
    const base = velo.futures.price(["open"]);
    const interest = base.openInterest(["close"]);

    expect(base.params(scope).columns).toEqual(["open_price"]);
    expect(interest.params(scope).columns).toEqual(["open_price", "dollar_open_interest_close"]);
  });

  it("rejects malformed scopes loudly at runtime", () => {
    const { velo } = client();
    const base = velo.futures.price(["close"]);

    expect(() => base.params({ ...scope, coins: ["BTC"] } as never)).toThrow(
      /scope cannot select both products and coins/,
    );
    expect(() => base.params({ between: [begin, end], resolution: "1h" } as never)).toThrow(
      /scope must select products or coins/,
    );
    expect(() => base.params({ ...scope, last: "10m" } as never)).toThrow(
      /scope cannot set both between and last/,
    );
    expect(() => base.params({ products: ["BTCUSDT"], resolution: "1h" } as never)).toThrow(
      /scope must set between or last/,
    );
    expect(() => base.params({ products: ["BTCUSDT"], last: "10m" } as never)).toThrow(
      /scope must set a resolution/,
    );
    expect(() => base.params({ products: ["BTCUSDT"], last: "0m", resolution: "1m" })).toThrow(
      VeloError,
    );
    expect(() =>
      base.params({ products: ["BTCUSDT"], last: "1d" as LastDuration, resolution: "1m" }),
    ).toThrow(VeloError);
  });

  it("delegates remaining validation to the params schema", () => {
    const { velo } = client();
    const invalid = [
      /* No columns selected. */
      () => velo.futures.exchanges(["bybit"]).params(scope),
      /* Inverted time range. */
      () => velo.futures.price(["close"]).params({ ...scope, between: [end, begin] }),
    ];

    for (const lower of invalid) {
      expect(lower).toThrow(VeloError);
      expect(lower).toThrow(/Invalid futures params/);
    }
  });

  it("reads the clock for each lowering but fixes it in a built query", async () => {
    vi.useFakeTimers();
    try {
      const urls: string[] = [];
      const { velo } = client("exchange,coin,product,time,open_price\n", urls);
      const builder = velo.futures.price(["open"]);
      const trailing = { products: ["BTCUSDT"], last: "11m", resolution: "1m" } as const;
      const firstEnd = Date.UTC(2026, 6, 13, 10);
      const secondEnd = firstEnd + 5 * 60_000;

      vi.setSystemTime(firstEnd);
      expect(builder.params(trailing)).toMatchObject({
        begin: firstEnd - 11 * 60_000,
        end: firstEnd,
      });
      vi.setSystemTime(secondEnd);
      expect(builder.params(trailing)).toMatchObject({
        begin: secondEnd - 11 * 60_000,
        end: secondEnd,
      });

      vi.setSystemTime(firstEnd);
      await builder.execute(trailing);
      vi.setSystemTime(secondEnd);
      await builder.execute(trailing);
      expect(search(urls[0]!).get("end")).toBe(String(firstEnd));
      expect(search(urls[1]!).get("end")).toBe(String(secondEnd));

      vi.setSystemTime(firstEnd);
      const query = builder.build(trailing);
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
      const base = velo.futures.price(["open"]);
      const durations = [
        ["2h", 2 * 60 * 60 * 1_000],
        ["3D", 3 * 24 * 60 * 60 * 1_000],
        ["2W", 2 * 7 * 24 * 60 * 60 * 1_000],
      ] as const satisfies readonly (readonly [LastDuration, number])[];

      for (const [duration, milliseconds] of durations) {
        expect(
          base.params({ products: ["BTCUSDT"], last: duration, resolution: "1m" }),
        ).toMatchObject({
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
      .price(["open", "high"])
      .openInterest(["close"])
      .exchanges(["bybit"])
      .execute({ products: ["BTCUSDT"], between: [begin, end], resolution: "1h" });

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
