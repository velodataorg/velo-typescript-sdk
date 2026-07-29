import { describe, expect, it, vi } from "vitest";

import { VeloError } from "../../../errors.js";
import { Velo } from "../../client.js";
import { OPTIONS_COLUMNS } from "../../common/market/columns.js";
import { OPTIONS_EXCHANGES, type OptionsExchange } from "../../common/market/exchanges.js";
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

describe("options fluent builder", () => {
  const begin = Date.UTC(2026, 6, 13, 8);
  const end = Date.UTC(2026, 6, 13, 10);
  const scope = { coins: ["BTC"], between: [begin, end], resolution: "1h" } as const;

  it("keeps builder terminal methods off the options namespace", () => {
    const { options } = client().velo;

    expect(options).not.toHaveProperty("params");
    expect(options).not.toHaveProperty("build");
    expect(options).not.toHaveProperty("execute");
  });

  it("exposes every selector as an options namespace entry point", () => {
    const { options } = client().velo;
    const selectors = [
      "iv",
      "skew",
      "vega",
      "delta",
      "gamma",
      "volume",
      "dollarVolume",
      "premium",
      "notional",
      "dvol",
      "indexPrice",
    ] as const;

    for (const selector of selectors) {
      expect(options[selector]).toBeTypeOf("function");
    }
  });

  it("accumulates typed columns, deduplicates them, and preserves insertion order", () => {
    const builder = client()
      .velo.options.iv(["1m", "1w"])
      .iv(["1w", "3m"])
      .delta(["call"], { metric: "coin" })
      .dvol(["close"])
      .indexPrice();

    expect(builder.params(scope).columns).toEqual([
      "iv_1m",
      "iv_1w",
      "iv_3m",
      "call_delta_coins",
      "dvol_close",
      "index_price",
    ]);
  });

  it("defaults to every options exchange and accepts an explicit replacement", () => {
    const base = client().velo.options.iv(["1m"]);

    expect(base.params(scope).exchanges).toEqual(OPTIONS_EXCHANGES);
    expect(base.exchanges(["deribit"]).params(scope).exchanges).toEqual(["deribit"]);
  });

  it("defaults tenor and OHLC selectors to every applicable column", () => {
    const builder = client().velo.options.iv().skew().dvol();

    expect(builder.params(scope).columns).toEqual([
      "iv_1w",
      "iv_1m",
      "iv_3m",
      "iv_6m",
      "skew_1w",
      "skew_1m",
      "skew_3m",
      "skew_6m",
      "dvol_open",
      "dvol_high",
      "dvol_low",
      "dvol_close",
    ]);
  });

  it("uses dollar defaults for metric-based Greek selectors", () => {
    const builder = client().velo.options.vega().delta().gamma();

    expect(builder.params(scope).columns).toEqual([
      "vega_dollars",
      "call_delta_dollars",
      "put_delta_dollars",
      "gamma_dollars",
    ]);
  });

  it("maps side and metric selectors to exact accumulated column types", () => {
    const builder = client()
      .velo.options.vega({ metric: "coin" })
      .delta(["put"], { metric: "coin" })
      .gamma({ metric: "coin" })
      .volume(["call"])
      .dollarVolume()
      .premium(["put"])
      .notional(["call"]);

    expect(builder.params(scope).columns).toEqual([
      "vega_coins",
      "put_delta_coins",
      "gamma_coins",
      "call_volume",
      "dollar_volume",
      "put_premium",
      "call_notional",
    ]);
  });

  it("makes every options column reachable through fluent selectors", () => {
    const columns = client()
      .velo.options.iv()
      .skew()
      .vega()
      .vega({ metric: "coin" })
      .delta()
      .delta({ metric: "coin" })
      .gamma()
      .gamma({ metric: "coin" })
      .volume()
      .dollarVolume()
      .premium()
      .notional()
      .dvol()
      .indexPrice()
      .params(scope).columns;

    expect(columns).toHaveLength(OPTIONS_COLUMNS.length);
    expect(new Set(columns)).toEqual(new Set(OPTIONS_COLUMNS));
  });

  it("snapshots chain arrays, lowers the scope per call, and returns fresh copies", () => {
    const { velo } = client();
    const exchanges: OptionsExchange[] = ["deribit"];
    const coins = ["BTC"];
    const builder = velo.options.iv(["1m"]).exchanges(exchanges);
    const liveScope = { coins, between: [begin, end], resolution: "1h" } as const;

    exchanges.push("deribit");

    const first = builder.params(liveScope);
    expect(first).toMatchObject({
      exchanges: ["deribit"],
      coins: ["BTC"],
      begin,
      end,
    });

    (first.exchanges as OptionsExchange[]).push("deribit");
    (first.coins as string[]).push("ETH");
    expect(builder.params(liveScope)).toMatchObject({
      exchanges: ["deribit"],
      coins: ["BTC"],
    });

    coins[0] = "ETH";
    expect(builder.params(liveScope).coins).toEqual(["ETH"]);
  });

  it("supports immutable branching", () => {
    const base = client().velo.options.iv(["1m"]);
    const greeks = base.delta(["call"]);

    expect(base.params(scope).columns).toEqual(["iv_1m"]);
    expect(greeks.params(scope).columns).toEqual(["iv_1m", "call_delta_dollars"]);
  });

  it("rejects empty and possibly-undefined selections", () => {
    const { velo } = client();
    const maybeTenor = undefined as "1m" | undefined;
    const maybeMetric = undefined as { readonly metric: "coin" } | undefined;

    expect(() => velo.options.iv([])).toThrow(VeloError);
    expect(() => velo.options.delta([], { metric: "coin" })).toThrow(VeloError);

    /* Never called: these statements pin compile-time rejections only. */
    const compileTimeOnly = () => {
      // @ts-expect-error a bare tenor is not a selection; wrap it in an array
      velo.options.iv("1m");
      // @ts-expect-error a possibly-undefined tenor must be branched on explicitly
      velo.options.iv(maybeTenor);
      // @ts-expect-error possibly-undefined options must be branched on explicitly
      velo.options.vega(maybeMetric);
      // @ts-expect-error explicit undefined selects nothing; call with no arguments instead
      velo.options.delta(undefined, { metric: "coin" });
    };
    void compileTimeOnly;
  });

  it("rejects incomplete scopes at compile time", () => {
    const { velo } = client();

    /* Never called: these statements pin compile-time rejections only. */
    const compileTimeOnly = () => {
      // @ts-expect-error the scope must select products or coins
      velo.options.iv(["1m"]).params({ between: [begin, end], resolution: "1h" });
      // @ts-expect-error the scope must set between or last
      velo.options.iv(["1m"]).params({ coins: ["BTC"], resolution: "1h" });
      // @ts-expect-error the scope must set a resolution
      velo.options.iv(["1m"]).params({ coins: ["BTC"], between: [begin, end] });
      // @ts-expect-error the scope cannot select both products and coins
      velo.options.iv(["1m"]).build({ ...scope, products: ["BTC-OPTION"] });
      // @ts-expect-error a terminal method requires a scope
      velo.options.iv(["1m"]).execute();
    };
    void compileTimeOnly;
  });

  it("rejects malformed scopes loudly at runtime", () => {
    const { velo } = client();
    const base = velo.options.iv(["1m"]);

    expect(() => base.params({ ...scope, products: ["BTC-OPTION"] } as never)).toThrow(
      /scope cannot select both products and coins/,
    );
    expect(() => base.params({ between: [begin, end], resolution: "1h" } as never)).toThrow(
      /scope must select products or coins/,
    );
    expect(() => base.params({ coins: ["BTC"], resolution: "1h" } as never)).toThrow(
      /scope must set between or last/,
    );
    expect(() => base.params({ coins: ["BTC"], between: [begin, end] } as never)).toThrow(
      /scope must set a resolution/,
    );
    expect(() => base.params({ ...scope, last: "10m" } as never)).toThrow(
      /scope cannot set both between and last/,
    );
    expect(() => base.params({ coins: ["BTC"], last: "0m", resolution: "1m" })).toThrow(VeloError);
    expect(() =>
      base.params({ coins: ["BTC"], last: "1d" as LastDuration, resolution: "1m" }),
    ).toThrow(VeloError);
  });

  it("delegates remaining validation to the params schema", () => {
    const { velo } = client();
    const invalid = [
      /* No columns selected. */
      () => velo.options.exchanges(["deribit"]).params(scope),
      /* Inverted time range. */
      () => velo.options.iv(["1m"]).params({ ...scope, between: [end, begin] }),
    ];

    for (const lower of invalid) {
      expect(lower).toThrow(VeloError);
      expect(lower).toThrow(/Invalid options params/);
    }
  });

  it("reads the clock for each lowering but fixes it in a built query", async () => {
    vi.useFakeTimers();
    try {
      const urls: string[] = [];
      const { velo } = client("exchange,coin,product,time,iv_1m\n", urls);
      const builder = velo.options.iv(["1m"]);
      const trailing = { coins: ["BTC"], last: "11m", resolution: "1m" } as const;
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
      "exchange,coin,product,time,iv_1m,call_delta_coins,dvol_close,index_price\n" +
      "deribit,BTC,BTC,1783929600000,0.55,120,52.4,63100\n";
    const { velo, urls } = client(body);
    const data = await velo.options
      .iv(["1m"])
      .delta(["call"], { metric: "coin" })
      .dvol(["close"])
      .indexPrice()
      .exchanges(["deribit"])
      .execute({ coins: ["BTC"], between: [begin, end], resolution: "1h" });

    expect(data.rows()).toEqual([
      {
        exchange: "deribit",
        coin: "BTC",
        product: "BTC",
        time: 1783929600000,
        iv_1m: 0.55,
        call_delta_coins: 120,
        dvol_close: 52.4,
        index_price: 63_100,
      },
    ]);

    const sent = search(urls[0]!);
    expect(sent.get("type")).toBe("options");
    expect(sent.get("exchanges")).toBe("deribit");
    expect(sent.get("coins")).toBe("BTC");
    expect(sent.get("products")).toBeNull();
    expect(sent.get("columns")).toBe("iv_1m,call_delta_coins,dvol_close,index_price");
    expect(sent.get("begin")).toBe(String(begin));
    expect(sent.get("end")).toBe(String(end));
    expect(sent.get("resolution")).toBe("60");
  });
});
