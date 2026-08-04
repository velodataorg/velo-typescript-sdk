import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { VeloError } from "../../../errors.ts";
import { Velo } from "../../client.ts";
import type { Data } from "../../data/data.ts";
import { OPTIONS_COLUMNS } from "../../market/columns.ts";
import { OPTIONS_EXCHANGES, type OptionsExchange } from "../../market/exchanges.ts";
import type { QueryRequest } from "../../query/plan.ts";
import type { LastDuration } from "./builder.ts";
import type { OptionsParams, OptionsRow } from "./params.ts";
import type { OptionsIvColumn } from "./selectors.ts";

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
  const market = { coins: ["BTC"] } as const;
  const window = { between: [begin, end], resolution: "1h" } as const;

  it("keeps builder terminal methods off the options namespace", () => {
    const { options } = client().velo;

    expect(options).not.toHaveProperty("params");
    expect(options).not.toHaveProperty("build");
    expect(options).not.toHaveProperty("fetch");
    expect(options).not.toHaveProperty("stream");
    expect(options).not.toHaveProperty("exchanges");
    const builder = options.iv(["1m"]);
    expect(builder).not.toHaveProperty("fetch");
    expect(builder).not.toHaveProperty("stream");
    expect(builder).not.toHaveProperty("exchanges");
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

    expect(builder.for(market).over(window).params().columns).toEqual([
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

    expect(base.for(market).over(window).params().exchanges).toEqual(OPTIONS_EXCHANGES);
    expect(
      base
        .for({ ...market, exchanges: ["deribit"] })
        .over(window)
        .params().exchanges,
    ).toEqual(["deribit"]);
  });

  it("omits candles from options result types", () => {
    const { velo } = client();
    const iv = velo.options.iv().for(market).over(window);
    const query = velo.query(iv);

    expectTypeOf<Awaited<typeof query>>().toEqualTypeOf<Data<OptionsExchange, OptionsIvColumn>>();
    expectTypeOf<Awaited<typeof query>>().not.toHaveProperty("candles");
  });

  it("preserves exact request, row, and result types through velo.query", () => {
    const { velo } = client();
    const builder = velo.options.iv(["1m"]).for(market).over(window);
    const request = builder.build();
    const query = velo.query(builder);

    expectTypeOf(request).toEqualTypeOf<QueryRequest<"options.rows", OptionsParams<"iv_1m">>>();
    expectTypeOf(query).toEqualTypeOf<Promise<Data<OptionsExchange, "iv_1m">>>();
  });

  it("defaults tenor and OHLC selectors to every applicable column", () => {
    const builder = client().velo.options.iv().skew().dvol();

    expect(builder.for(market).over(window).params().columns).toEqual([
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

    expect(builder.for(market).over(window).params().columns).toEqual([
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

    expect(builder.for(market).over(window).params().columns).toEqual([
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
      .for(market)
      .over(window)
      .params().columns;

    expect(columns).toHaveLength(OPTIONS_COLUMNS.length);
    expect(new Set(columns)).toEqual(new Set(OPTIONS_COLUMNS));
  });

  it("snapshots scope arrays and returns fresh params", () => {
    const { velo } = client();
    const exchanges: OptionsExchange[] = ["deribit"];
    const coins = ["BTC"];
    const builder = velo.options
      .iv(["1m"])
      .for({ exchanges, coins })
      .over({ between: [begin, end], resolution: "1h" });

    coins[0] = "ETH";

    const first = builder.params();
    expect(first).toMatchObject({
      exchanges: ["deribit"],
      coins: ["BTC"],
      begin,
      end,
    });

    (first.exchanges as OptionsExchange[]).push("deribit");
    (first.coins as string[]).push("ETH");
    expect(builder.params()).toMatchObject({
      exchanges: ["deribit"],
      coins: ["BTC"],
    });
  });

  it("builds a frozen request that fixes scope arrays", async () => {
    const urls: string[] = [];
    const { velo } = client("exchange,coin,product,time,iv_1m\n", urls);
    const exchanges: OptionsExchange[] = ["deribit"];
    const coins = ["BTC"];
    const request = velo.options.iv(["1m"]).for({ exchanges, coins }).over(window).build();

    coins[0] = "ETH";
    expect(request.kind).toBe("options.rows");
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.params)).toBe(true);
    expect(Object.isFrozen(request.params.exchanges)).toBe(true);
    expect(Object.isFrozen(request.params.columns)).toBe(true);
    expect(Object.isFrozen(request.params.coins)).toBe(true);
    await velo.query(request);

    const sent = search(urls[0]!);
    expect(sent.get("exchanges")).toBe("deribit");
    expect(sent.get("coins")).toBe("BTC");
  });

  it("supports immutable branching", () => {
    const base = client().velo.options.iv(["1m"]).for(market).over(window);
    const greeks = base.delta(["call"]);
    const ethereum = base.for({ coins: ["ETH"] });

    expect(base.params().columns).toEqual(["iv_1m"]);
    expect(greeks.params().columns).toEqual(["iv_1m", "call_delta_dollars"]);
    expect(ethereum.params().coins).toEqual(["ETH"]);
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

  it("rejects incomplete builder scopes at compile time", () => {
    const { velo } = client();
    const base = velo.options.iv(["1m"]);

    /* Never called: these statements pin compile-time rejections only. */
    const compileTimeOnly = () => {
      // @ts-expect-error for() and over() are both required
      base.params();
      // @ts-expect-error over() is required
      base.for(market).build();
      // @ts-expect-error incomplete builders cannot be passed to the central query pipeline
      velo.query(base);
      // @ts-expect-error for() must select products or coins
      base.for({ exchanges: ["deribit"] });
      // @ts-expect-error over() must set between or last
      base.over({ resolution: "1h" });
      // @ts-expect-error over() must set a resolution
      base.over({ between: [begin, end] });
      // @ts-expect-error for() cannot select both products and coins
      base.for({ ...market, products: ["BTC-OPTION"] });
      // @ts-expect-error over() cannot set both between and last
      base.over({ ...window, last: "10m" });
      // @ts-expect-error spot exchanges are not valid options exchanges
      base.for({ ...market, exchanges: ["coinbase"] });
    };
    void compileTimeOnly;
  });

  it("preserves readiness through selectors and accepts either scope order", () => {
    const { velo } = client();
    const marketFirst = velo.options.iv(["1m"]).for(market).dvol(["close"]).over(window);
    const windowFirst = velo.options.iv(["1m"]).over(window).delta(["call"]).for(market);

    expect(marketFirst.params().columns).toEqual(["iv_1m", "dvol_close"]);
    expect(windowFirst.params().columns).toEqual(["iv_1m", "call_delta_dollars"]);
  });

  it("rejects incomplete and malformed scopes loudly at runtime", () => {
    const { velo } = client();
    const base = velo.options.iv(["1m"]);

    expect(() => (base as unknown as { params(): unknown }).params()).toThrow(
      /for\(\) must be called/,
    );
    expect(() => (base.for(market) as unknown as { params(): unknown }).params()).toThrow(
      /over\(\) must be called/,
    );
    expect(() => base.for({ ...market, products: ["BTC-OPTION"] } as never)).toThrow(
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
        velo.options
          .iv(["1m"])
          .for({ ...market, exchanges: [] })
          .over(window)
          .params(),
      /* Duplicate exchanges. */
      () =>
        velo.options
          .iv(["1m"])
          .for({ ...market, exchanges: ["deribit", "deribit"] })
          .over(window)
          .params(),
      /* Unsupported exchanges from untyped input. */
      () =>
        velo.options
          .iv(["1m"])
          .for({ ...market, exchanges: ["coinbase"] } as never)
          .over(window)
          .params(),
      /* Inverted time range. */
      () =>
        velo.options
          .iv(["1m"])
          .for(market)
          .over({ between: [end, begin], resolution: "1h" })
          .params(),
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
      const builder = velo.options
        .iv(["1m"])
        .for({ coins: ["BTC"] })
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
      await velo.query(builder);
      vi.setSystemTime(secondEnd);
      await velo.query(builder);
      expect(search(urls[0]!).get("end")).toBe(String(firstEnd));
      expect(search(urls[1]!).get("end")).toBe(String(secondEnd));

      vi.setSystemTime(firstEnd);
      const query = velo.query(builder.build());
      vi.setSystemTime(secondEnd);
      const first = await query;
      vi.setSystemTime(secondEnd + 5 * 60_000);
      const second = await query;
      expect(search(urls[2]!).get("end")).toBe(String(firstEnd));
      expect(urls).toHaveLength(3);
      expect(second).toBe(first);
    } finally {
      vi.useRealTimers();
    }
  });

  it("lowers through the central query pipeline and decodes typed data", async () => {
    const body =
      "exchange,coin,product,time,iv_1m,call_delta_coins,dvol_close,index_price\n" +
      "deribit,BTC,BTC,1783929600000,0.55,120,52.4,63100\n";
    const { velo, urls } = client(body);
    const data = await velo.query(
      velo.options
        .iv(["1m"])
        .delta(["call"], { metric: "coin" })
        .dvol(["close"])
        .indexPrice()
        .for({
          exchanges: ["deribit"],
          coins: ["BTC"],
        })
        .over({
          between: [begin, end],
          resolution: "1h",
        }),
    );

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

  it("streams directly from a fully scoped builder", async () => {
    const body = "exchange,coin,product,time,iv_1m\n" + "deribit,BTC,BTC,1783929600000,0.55\n";
    const { velo, urls } = client(body);
    const rows: OptionsRow<"iv_1m">[] = [];

    const request = velo.options
      .iv(["1m"])
      .for({ exchanges: ["deribit"], coins: ["BTC"] })
      .over(window);
    for await (const row of velo.stream(request)) {
      rows.push(row);
    }

    expect(rows).toEqual([
      {
        exchange: "deribit",
        coin: "BTC",
        product: "BTC",
        time: 1783929600000,
        iv_1m: 0.55,
      },
    ]);
    expect(search(urls[0]!).get("columns")).toBe("iv_1m");
  });
});
