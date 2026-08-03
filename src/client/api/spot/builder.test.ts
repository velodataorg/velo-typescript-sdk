import { describe, expect, it, vi } from "vitest";

import { VeloError } from "../../../errors.js";
import { Velo } from "../../client.js";
import { SPOT_COLUMNS } from "../../common/market/columns.js";
import { SPOT_EXCHANGES, type SpotExchange } from "../../common/market/exchanges.js";
import type { LastDuration } from "./builder.js";

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
  const market = { products: ["BTC-USD"] } as const;
  const window = { between: [begin, end], resolution: "1h" } as const;

  it("keeps builder terminal methods off the spot namespace", () => {
    const { spot } = client().velo;

    expect(spot).not.toHaveProperty("params");
    expect(spot).not.toHaveProperty("build");
    expect(spot).not.toHaveProperty("fetch");
    expect(spot).not.toHaveProperty("stream");
    expect(spot).not.toHaveProperty("exchanges");
    expect(spot.price(["close"])).not.toHaveProperty("exchanges");
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

    expect(builder.for(market).over(window).params().columns).toEqual([
      "close_price",
      "open_price",
      "high_price",
      "buy_coin_volume",
      "sell_trades",
    ]);
  });

  it("defaults to every spot exchange and accepts an explicit replacement", () => {
    const base = client().velo.spot.price(["close"]);

    expect(base.for(market).over(window).params().exchanges).toEqual(SPOT_EXCHANGES);
    expect(
      base
        .for({ ...market, exchanges: ["coinbase"] })
        .over(window)
        .params().exchanges,
    ).toEqual(["coinbase"]);
  });

  it("defaults selectors to every applicable column", () => {
    const prices = client().velo.spot.price();
    const dollarVolume = client().velo.spot.volume();
    const coinVolume = client().velo.spot.volume({ metric: "coin" });

    expect(prices.for(market).over(window).params().columns).toEqual([
      "open_price",
      "high_price",
      "low_price",
      "close_price",
    ]);
    expect(dollarVolume.for(market).over(window).params().columns).toEqual([
      "dollar_volume",
      "buy_dollar_volume",
      "sell_dollar_volume",
    ]);
    expect(coinVolume.for(market).over(window).params().columns).toEqual([
      "coin_volume",
      "buy_coin_volume",
      "sell_coin_volume",
    ]);
  });

  it("makes every spot column reachable through fluent selectors", () => {
    const columns = client()
      .velo.spot.price()
      .volume()
      .volume({ metric: "coin" })
      .trades()
      .for(market)
      .over(window)
      .params().columns;

    expect(columns).toHaveLength(SPOT_COLUMNS.length);
    expect(new Set(columns)).toEqual(new Set(SPOT_COLUMNS));
  });

  it("snapshots scope arrays and returns fresh params", () => {
    const { velo } = client();
    const exchanges: SpotExchange[] = ["coinbase"];
    const products = ["BTC-USD"];
    const builder = velo.spot
      .price(["close"])
      .for({ exchanges, products })
      .over({ between: [begin, end], resolution: "1h" });

    exchanges.push("binance");
    products[0] = "ETH-USD";

    const first = builder.params();
    expect(first).toMatchObject({
      exchanges: ["coinbase"],
      products: ["BTC-USD"],
      begin,
      end,
    });

    (first.exchanges as SpotExchange[]).push("binance");
    (first.products as string[]).push("ETH-USD");
    expect(builder.params()).toMatchObject({
      exchanges: ["coinbase"],
      products: ["BTC-USD"],
    });
  });

  it("supports immutable branching", () => {
    const base = client().velo.spot.price(["open"]).for(market).over(window);
    const volume = base.volume(["total"]);
    const ethereum = base.for({ products: ["ETH-USD"] });

    expect(base.params().columns).toEqual(["open_price"]);
    expect(volume.params().columns).toEqual(["open_price", "dollar_volume"]);
    expect(ethereum.params().products).toEqual(["ETH-USD"]);
  });

  it("rejects incomplete builder scopes at compile time", () => {
    const { velo } = client();
    const base = velo.spot.price(["close"]);

    /* Never called: these statements pin compile-time rejections only. */
    const compileTimeOnly = () => {
      // @ts-expect-error for() and over() are both required
      base.params();
      // @ts-expect-error over() is required
      base.for(market).build();
      // @ts-expect-error for() is required
      base.over(window).fetch();
      // @ts-expect-error for() is required
      base.over(window).stream();
      // @ts-expect-error for() must select products or coins
      base.for({ exchanges: ["coinbase"] });
      // @ts-expect-error over() must set between or last
      base.over({ resolution: "1h" });
      // @ts-expect-error over() must set a resolution
      base.over({ between: [begin, end] });
      // @ts-expect-error for() cannot select both products and coins
      base.for({ ...market, coins: ["BTC"] });
      // @ts-expect-error over() cannot set both between and last
      base.over({ ...window, last: "10m" });
      // @ts-expect-error futures exchanges are not valid spot exchanges
      base.for({ ...market, exchanges: ["bybit"] });
    };
    void compileTimeOnly;
  });

  it("preserves readiness through selectors and accepts either scope order", () => {
    const { velo } = client();
    const marketFirst = velo.spot.price(["close"]).for(market).trades(["buy"]).over(window);
    const windowFirst = velo.spot.price(["close"]).over(window).volume(["total"]).for(market);

    expect(marketFirst.params().columns).toEqual(["close_price", "buy_trades"]);
    expect(windowFirst.params().columns).toEqual(["close_price", "dollar_volume"]);
  });

  it("rejects incomplete and malformed scopes loudly at runtime", () => {
    const { velo } = client();
    const base = velo.spot.price(["close"]);

    expect(() => (base as unknown as { params(): unknown }).params()).toThrow(
      /for\(\) must be called/,
    );
    expect(() => (base.for(market) as unknown as { params(): unknown }).params()).toThrow(
      /over\(\) must be called/,
    );
    expect(() => base.for({ ...market, coins: ["BTC"] } as never)).toThrow(
      /scope cannot select both products and coins/,
    );
    expect(() => base.for({} as never)).toThrow(/scope must select products or coins/);
    expect(() => base.over({ resolution: "1h" } as never)).toThrow(
      /scope must set between or last/,
    );
    expect(() => base.over({ last: "10m" } as never)).toThrow(/scope must set a resolution/);
    expect(() => base.over({ ...window, last: "10m" } as never)).toThrow(
      /scope cannot set both between and last/,
    );
    expect(() => base.over({ last: "0m", resolution: "1m" })).toThrow(VeloError);
    expect(() => base.over({ last: "1d" as LastDuration, resolution: "1m" })).toThrow(VeloError);
  });

  it("delegates remaining validation to the params schema", () => {
    const { velo } = client();
    const invalid = [
      /* Empty exchanges. */
      () =>
        velo.spot
          .price(["close"])
          .for({ ...market, exchanges: [] })
          .over(window)
          .params(),
      /* Duplicate exchanges. */
      () =>
        velo.spot
          .price(["close"])
          .for({ ...market, exchanges: ["coinbase", "coinbase"] })
          .over(window)
          .params(),
      /* Unsupported exchanges from untyped input. */
      () =>
        velo.spot
          .price(["close"])
          .for({ ...market, exchanges: ["bybit"] } as never)
          .over(window)
          .params(),
      /* Inverted time range. */
      () =>
        velo.spot
          .price(["close"])
          .for(market)
          .over({ between: [end, begin], resolution: "1h" })
          .params(),
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
      const builder = velo.spot
        .price(["open"])
        .for({ products: ["BTC-USD"] })
        .over({ last: "11m", resolution: "1m" });
      const firstEnd = Date.UTC(2026, 6, 13, 10);
      const secondEnd = firstEnd + 5 * 60_000;

      vi.setSystemTime(firstEnd);
      expect(builder.params()).toMatchObject({
        begin: firstEnd - 11 * 60_000,
        end: firstEnd,
      });
      vi.setSystemTime(secondEnd);
      expect(builder.params()).toMatchObject({
        begin: secondEnd - 11 * 60_000,
        end: secondEnd,
      });

      vi.setSystemTime(firstEnd);
      await builder.fetch();
      vi.setSystemTime(secondEnd);
      await builder.fetch();
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

  it("lowers through the existing query pipeline and decodes typed data", async () => {
    const body =
      "exchange,coin,product,time,open_price,high_price,buy_coin_volume\n" +
      "coinbase,BTC,BTC-USD,1783929600000,63100,63200,12.5\n";
    const { velo, urls } = client(body);
    const data = await velo.spot
      .price(["open", "high"])
      .volume(["buy"], { metric: "coin" })
      .for({
        exchanges: ["coinbase"],
        products: ["BTC-USD"],
      })
      .over({
        between: [begin, end],
        resolution: "1h",
      })
      .fetch();

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
});
