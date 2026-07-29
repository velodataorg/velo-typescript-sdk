import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { VeloError } from "../../../errors.js";
import { Velo } from "../../client.js";
import type { Data } from "../../common/data/data.js";
import { SPOT_COLUMNS } from "../../common/market/columns.js";
import { SPOT_EXCHANGES, type SpotExchange } from "../../common/market/exchanges.js";
import type { LastDuration, SpotBuilder } from "./builder.js";

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

describe("spot fluent builder", () => {
  const begin = Date.UTC(2026, 6, 13, 8);
  const end = Date.UTC(2026, 6, 13, 10);
  const scope = { products: ["BTC-USD"], between: [begin, end], resolution: "1h" } as const;

  it("keeps builder terminal methods off the spot namespace", () => {
    const { spot } = client().velo;

    expect(spot).not.toHaveProperty("params");
    expect(spot).not.toHaveProperty("build");
    expect(spot).not.toHaveProperty("execute");
  });

  it("exposes every selector as a spot namespace entry point", () => {
    const { spot } = client().velo;

    for (const selector of ["price", "volume", "trades"] as const) {
      expect(spot[selector]).toBeTypeOf("function");
    }
  });

  it("accumulates typed columns, deduplicates them, and preserves insertion order", () => {
    const builder = client()
      .velo.spot.price(["close", "open"])
      .price(["open", "high"])
      .volume(["buy"], { metric: "coin" })
      .trades(["sell"]);

    expect(builder.params(scope).columns).toEqual([
      "close_price",
      "open_price",
      "high_price",
      "buy_coin_volume",
      "sell_trades",
    ]);
    expectTypeOf(builder).toEqualTypeOf<
      SpotBuilder<"close_price" | "open_price" | "high_price" | "buy_coin_volume" | "sell_trades">
    >();
  });

  it("defaults to every spot exchange and accepts an explicit replacement", () => {
    const base = client().velo.spot.price(["close"]);

    expect(base.params(scope).exchanges).toEqual(SPOT_EXCHANGES);
    expect(base.exchanges(["coinbase"]).params(scope).exchanges).toEqual(["coinbase"]);
  });

  it("defaults selectors to every applicable column", () => {
    const prices = client().velo.spot.price();
    const dollarVolume = client().velo.spot.volume();
    const coinVolume = client().velo.spot.volume({ metric: "coin" });

    expect(prices.params(scope).columns).toEqual([
      "open_price",
      "high_price",
      "low_price",
      "close_price",
    ]);
    expect(dollarVolume.params(scope).columns).toEqual([
      "dollar_volume",
      "buy_dollar_volume",
      "sell_dollar_volume",
    ]);
    expect(coinVolume.params(scope).columns).toEqual([
      "coin_volume",
      "buy_coin_volume",
      "sell_coin_volume",
    ]);
    expectTypeOf(prices).toEqualTypeOf<
      SpotBuilder<"open_price" | "high_price" | "low_price" | "close_price">
    >();
    expectTypeOf(coinVolume).toEqualTypeOf<
      SpotBuilder<"coin_volume" | "buy_coin_volume" | "sell_coin_volume">
    >();
  });

  it("makes every spot column reachable through fluent selectors", () => {
    const columns = client()
      .velo.spot.price()
      .volume()
      .volume({ metric: "coin" })
      .trades()
      .params(scope).columns;

    expect(columns).toHaveLength(SPOT_COLUMNS.length);
    expect(new Set(columns)).toEqual(new Set(SPOT_COLUMNS));
  });

  it("snapshots chain arrays, lowers the scope per call, and returns fresh copies", () => {
    const { velo } = client();
    const exchanges: SpotExchange[] = ["coinbase"];
    const products = ["BTC-USD"];
    const builder = velo.spot.price(["close"]).exchanges(exchanges);
    const liveScope = { products, between: [begin, end], resolution: "1h" } as const;

    exchanges.push("binance");

    const first = builder.params(liveScope);
    expect(first).toMatchObject({
      exchanges: ["coinbase"],
      products: ["BTC-USD"],
      begin,
      end,
    });

    (first.exchanges as SpotExchange[]).push("binance");
    (first.products as string[]).push("ETH-USD");
    expect(builder.params(liveScope)).toMatchObject({
      exchanges: ["coinbase"],
      products: ["BTC-USD"],
    });

    products[0] = "ETH-USD";
    expect(builder.params(liveScope).products).toEqual(["ETH-USD"]);
  });

  it("supports immutable branching", () => {
    const base = client().velo.spot.price(["open"]);
    const volume = base.volume(["total"]);

    expect(base.params(scope).columns).toEqual(["open_price"]);
    expect(volume.params(scope).columns).toEqual(["open_price", "dollar_volume"]);
  });

  it("rejects incomplete scopes at compile time", () => {
    const { velo } = client();

    /* Never called: these statements pin compile-time rejections only. */
    const compileTimeOnly = () => {
      // @ts-expect-error the scope must select products or coins
      velo.spot.price(["close"]).params({ between: [begin, end], resolution: "1h" });
      // @ts-expect-error the scope must set between or last
      velo.spot.price(["close"]).params({ products: ["BTC-USD"], resolution: "1h" });
      // @ts-expect-error the scope must set a resolution
      velo.spot.price(["close"]).params({ products: ["BTC-USD"], between: [begin, end] });
      // @ts-expect-error the scope cannot select both products and coins
      velo.spot.price(["close"]).build({ ...scope, coins: ["BTC"] });
      // @ts-expect-error a terminal method requires a scope
      velo.spot.price(["close"]).execute();
    };
    void compileTimeOnly;
  });

  it("rejects malformed scopes loudly at runtime", () => {
    const { velo } = client();
    const base = velo.spot.price(["close"]);

    expect(() => base.params({ ...scope, coins: ["BTC"] } as never)).toThrow(
      /scope cannot select both products and coins/,
    );
    expect(() => base.params({ between: [begin, end], resolution: "1h" } as never)).toThrow(
      /scope must select products or coins/,
    );
    expect(() => base.params({ products: ["BTC-USD"], resolution: "1h" } as never)).toThrow(
      /scope must set between or last/,
    );
    expect(() => base.params({ products: ["BTC-USD"], last: "0m", resolution: "1m" })).toThrow(
      VeloError,
    );
    expect(() =>
      base.params({ products: ["BTC-USD"], last: "1d" as LastDuration, resolution: "1m" }),
    ).toThrow(VeloError);
  });

  it("delegates remaining validation to the params schema", () => {
    const { velo } = client();
    const invalid = [
      /* No columns selected. */
      () => velo.spot.exchanges(["coinbase"]).params(scope),
      /* Inverted time range. */
      () => velo.spot.price(["close"]).params({ ...scope, between: [end, begin] }),
    ];

    for (const lower of invalid) {
      expect(lower).toThrow(VeloError);
      expect(lower).toThrow(/Invalid spot params/);
    }
  });

  it("reads the clock for each lowering but fixes it in a built query", async () => {
    vi.useFakeTimers();
    try {
      const urls: string[] = [];
      const { velo } = client("exchange,coin,product,time,open_price\n", urls);
      const builder = velo.spot.price(["open"]);
      const trailing = { products: ["BTC-USD"], last: "11m", resolution: "1m" } as const;
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

  it("lowers through the existing query pipeline and decodes typed data", async () => {
    const body =
      "exchange,coin,product,time,open_price,high_price,buy_coin_volume\n" +
      "coinbase,BTC,BTC-USD,1783929600000,63100,63200,12.5\n";
    const { velo, urls } = client(body);
    const data = await velo.spot
      .price(["open", "high"])
      .volume(["buy"], { metric: "coin" })
      .exchanges(["coinbase"])
      .execute({ products: ["BTC-USD"], between: [begin, end], resolution: "1h" });

    expect(data.rows()).toEqual([
      {
        exchange: "coinbase",
        coin: "BTC",
        product: "BTC-USD",
        time: 1783929600000,
        open_price: 63_100,
        high_price: 63_200,
        buy_coin_volume: 12.5,
      },
    ]);
    expectTypeOf(data).toEqualTypeOf<
      Data<SpotExchange, "open_price" | "high_price" | "buy_coin_volume">
    >();

    const sent = search(urls[0]!);
    expect(sent.get("type")).toBe("spot");
    expect(sent.get("exchanges")).toBe("coinbase");
    expect(sent.get("products")).toBe("BTC-USD");
    expect(sent.get("coins")).toBeNull();
    expect(sent.get("columns")).toBe("open_price,high_price,buy_coin_volume");
    expect(sent.get("begin")).toBe(String(begin));
    expect(sent.get("end")).toBe(String(end));
    expect(sent.get("resolution")).toBe("60");
  });

  it("does not expose terminals on the untouched namespace type", () => {
    const { velo } = client();
    type NamespaceTerminal = Extract<keyof typeof velo.spot, "params" | "build" | "execute">;
    expectTypeOf<NamespaceTerminal>().toEqualTypeOf<never>();
  });
});
