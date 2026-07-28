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
      .trades(["sell"])
      .products(["BTC-USDT"])
      .between(begin, end)
      .resolution("1h");

    expect(builder.params().columns).toEqual([
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
    const base = client()
      .velo.spot.price(["close"])
      .products(["BTC-USDT"])
      .between(begin, end)
      .resolution("1h");

    expect(base.params().exchanges).toEqual(SPOT_EXCHANGES);
    expect(base.exchanges(["coinbase"]).params().exchanges).toEqual(["coinbase"]);
  });

  it("defaults selectors to every applicable column", () => {
    const prices = client()
      .velo.spot.price()
      .products(["BTC-USDT"])
      .between(begin, end)
      .resolution("1h");
    const dollarVolume = client()
      .velo.spot.volume()
      .products(["BTC-USDT"])
      .between(begin, end)
      .resolution("1h");
    const coinVolume = client()
      .velo.spot.volume({ metric: "coin" })
      .products(["BTC-USDT"])
      .between(begin, end)
      .resolution("1h");

    expect(prices.params().columns).toEqual([
      "open_price",
      "high_price",
      "low_price",
      "close_price",
    ]);
    expect(dollarVolume.params().columns).toEqual([
      "dollar_volume",
      "buy_dollar_volume",
      "sell_dollar_volume",
    ]);
    expect(coinVolume.params().columns).toEqual([
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
      .products(["BTC-USDT"])
      .between(begin, end)
      .resolution("1h")
      .params().columns;

    expect(columns).toHaveLength(SPOT_COLUMNS.length);
    expect(new Set(columns)).toEqual(new Set(SPOT_COLUMNS));
  });

  it("snapshots caller-owned arrays and dates", () => {
    const { velo } = client();
    const exchanges: SpotExchange[] = ["coinbase"];
    const products = ["BTC-USD"];
    const rangeBegin = new Date(begin);
    const rangeEnd = new Date(end);
    const builder = velo.spot
      .price(["close"])
      .exchanges(exchanges)
      .products(products)
      .between(rangeBegin, rangeEnd)
      .resolution("1h");

    exchanges.push("binance");
    products[0] = "ETH-USD";
    rangeBegin.setTime(begin + 60_000);
    rangeEnd.setTime(end + 60_000);

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
    const base = client().velo.spot.products(["BTC-USD"]).between(begin, end).resolution("1h");
    const prices = base.price(["open"]);
    const volume = base.volume(["total"]);

    expect(prices.params().columns).toEqual(["open_price"]);
    expect(volume.params().columns).toEqual(["dollar_volume"]);
  });

  it("rejects conflicting selectors and malformed eager inputs", () => {
    const { velo } = client();

    expect(() => velo.spot.products(["BTC-USD"]).coins(["BTC"])).toThrow(VeloError);
    expect(() => velo.spot.coins(["BTC"]).products(["BTC-USD"])).toThrow(VeloError);
    expect(() => velo.spot.last("0m")).toThrow(VeloError);
    expect(() => velo.spot.last("1d" as LastDuration)).toThrow(VeloError);
  });

  it("uses the existing schema for incomplete chains", () => {
    const { velo } = client();
    const incomplete = [
      () => velo.spot.products(["BTC-USD"]).between(begin, end).resolution("1h").params(),
      () => velo.spot.price(["close"]).between(begin, end).resolution("1h").params(),
      () => velo.spot.price(["close"]).products(["BTC-USD"]).resolution("1h").params(),
    ];

    for (const lower of incomplete) {
      expect(lower).toThrow(VeloError);
      expect(lower).toThrow(/Invalid spot params/);
    }
  });

  it("reads the clock for each lowering but fixes it in a built query", async () => {
    vi.useFakeTimers();
    try {
      const urls: string[] = [];
      const { velo } = client("exchange,coin,product,time,open_price\n", urls);
      const builder = velo.spot.price(["open"]).products(["BTC-USD"]).last("11m").resolution("1m");
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

  it("lowers through the existing query pipeline and decodes typed data", async () => {
    const body =
      "exchange,coin,product,time,open_price,high_price,buy_coin_volume\n" +
      "coinbase,BTC,BTC-USD,1783929600000,63100,63200,12.5\n";
    const { velo, urls } = client(body);
    const data = await velo.spot
      .price(["open", "high"])
      .volume(["buy"], { metric: "coin" })
      .exchanges(["coinbase"])
      .products(["BTC-USD"])
      .between(begin, end)
      .resolution("1h")
      .execute();

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
