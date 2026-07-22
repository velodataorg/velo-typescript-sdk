import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { VeloError } from "../../../errors.js";
import { Velo } from "../../client.js";
import type { Data } from "../../common/data/data.js";
import { OPTIONS_COLUMNS } from "../../common/market/columns.js";
import { OPTIONS_EXCHANGES, type OptionsExchange } from "../../common/market/exchanges.js";
import type { LastDuration, OptionsBuilder } from "./builder.js";

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
      .velo.options.iv("1m", "1w")
      .iv("1w", "3m")
      .delta("call", { metric: "coin" })
      .dvol("close")
      .indexPrice()
      .coins(["BTC"])
      .between(begin, end)
      .resolution("1h");

    expect(builder.params().columns).toEqual([
      "iv_1m",
      "iv_1w",
      "iv_3m",
      "call_delta_coins",
      "dvol_close",
      "index_price",
    ]);
    expectTypeOf(builder).toEqualTypeOf<
      OptionsBuilder<
        "iv_1m" | "iv_1w" | "iv_3m" | "call_delta_coins" | "dvol_close" | "index_price"
      >
    >();
  });

  it("defaults to every options exchange and accepts an explicit replacement", () => {
    const base = client().velo.options.iv("1m").coins(["BTC"]).between(begin, end).resolution("1h");

    expect(base.params().exchanges).toEqual(OPTIONS_EXCHANGES);
    expect(base.exchanges(["deribit"]).params().exchanges).toEqual(["deribit"]);
  });

  it("defaults tenor and OHLC selectors to every applicable column", () => {
    const builder = client()
      .velo.options.iv()
      .skew()
      .dvol()
      .coins(["BTC"])
      .between(begin, end)
      .resolution("1h");

    expect(builder.params().columns).toEqual([
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
    expectTypeOf(builder).toEqualTypeOf<
      OptionsBuilder<
        | "iv_1w"
        | "iv_1m"
        | "iv_3m"
        | "iv_6m"
        | "skew_1w"
        | "skew_1m"
        | "skew_3m"
        | "skew_6m"
        | "dvol_open"
        | "dvol_high"
        | "dvol_low"
        | "dvol_close"
      >
    >();
  });

  it("uses dollar defaults for metric-based Greek selectors", () => {
    const builder = client()
      .velo.options.vega()
      .delta()
      .gamma()
      .coins(["BTC"])
      .between(begin, end)
      .resolution("1h");

    expect(builder.params().columns).toEqual([
      "vega_dollars",
      "call_delta_dollars",
      "put_delta_dollars",
      "gamma_dollars",
    ]);
    expectTypeOf(builder).toEqualTypeOf<
      OptionsBuilder<"vega_dollars" | "call_delta_dollars" | "put_delta_dollars" | "gamma_dollars">
    >();
  });

  it("maps side and metric selectors to exact accumulated column types", () => {
    const builder = client()
      .velo.options.vega({ metric: "coin" })
      .delta("put", { metric: "coin" })
      .gamma({ metric: "coin" })
      .volume("call")
      .dollarVolume()
      .premium("put")
      .notional("call")
      .coins(["BTC"])
      .between(begin, end)
      .resolution("1h");

    expect(builder.params().columns).toEqual([
      "vega_coins",
      "put_delta_coins",
      "gamma_coins",
      "call_volume",
      "dollar_volume",
      "put_premium",
      "call_notional",
    ]);
    expectTypeOf(builder).toEqualTypeOf<
      OptionsBuilder<
        | "vega_coins"
        | "put_delta_coins"
        | "gamma_coins"
        | "call_volume"
        | "dollar_volume"
        | "put_premium"
        | "call_notional"
      >
    >();
  });

  it("makes every options column reachable through fluent selectors", () => {
    const columns = client()
      .velo.options.iv()
      .skew()
      .vega()
      .vega({ metric: "coin" })
      .delta()
      .delta(undefined, { metric: "coin" })
      .gamma()
      .gamma({ metric: "coin" })
      .volume()
      .dollarVolume()
      .premium()
      .notional()
      .dvol()
      .indexPrice()
      .coins(["BTC"])
      .between(begin, end)
      .resolution("1h")
      .params().columns;

    expect(columns).toHaveLength(OPTIONS_COLUMNS.length);
    expect(new Set(columns)).toEqual(new Set(OPTIONS_COLUMNS));
  });

  it("snapshots caller-owned arrays and dates", () => {
    const { velo } = client();
    const exchanges: OptionsExchange[] = ["deribit"];
    const coins = ["BTC"];
    const rangeBegin = new Date(begin);
    const rangeEnd = new Date(end);
    const builder = velo.options
      .iv("1m")
      .exchanges(exchanges)
      .coins(coins)
      .between(rangeBegin, rangeEnd)
      .resolution("1h");

    exchanges.push("deribit");
    coins[0] = "ETH";
    rangeBegin.setTime(begin + 60_000);
    rangeEnd.setTime(end + 60_000);

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

  it("supports immutable branching", () => {
    const base = client().velo.options.coins(["BTC"]).between(begin, end).resolution("1h");
    const volatility = base.iv("1m");
    const greeks = base.delta("call");

    expect(volatility.params().columns).toEqual(["iv_1m"]);
    expect(greeks.params().columns).toEqual(["call_delta_dollars"]);
  });

  it("rejects conflicting selectors and malformed eager inputs", () => {
    const { velo } = client();

    expect(() => velo.options.products(["BTC-OPTION"]).coins(["BTC"])).toThrow(VeloError);
    expect(() => velo.options.coins(["BTC"]).products(["BTC-OPTION"])).toThrow(VeloError);
    expect(() => velo.options.last("0m")).toThrow(VeloError);
    expect(() => velo.options.last("1d" as LastDuration)).toThrow(VeloError);
  });

  it("uses the existing schema for incomplete chains", () => {
    const { velo } = client();
    const incomplete = [
      () => velo.options.coins(["BTC"]).between(begin, end).resolution("1h").params(),
      () => velo.options.iv("1m").between(begin, end).resolution("1h").params(),
      () => velo.options.iv("1m").coins(["BTC"]).resolution("1h").params(),
    ];

    for (const lower of incomplete) {
      expect(lower).toThrow(VeloError);
      expect(lower).toThrow(/Invalid options params/);
    }
  });

  it("reads the clock for each lowering but fixes it in a built query", async () => {
    vi.useFakeTimers();
    try {
      const urls: string[] = [];
      const { velo } = client("exchange,coin,product,time,iv_1m\n", urls);
      const builder = velo.options.iv("1m").coins(["BTC"]).last("11m").resolution("1m");
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
      "exchange,coin,product,time,iv_1m,call_delta_coins,dvol_close,index_price\n" +
      "deribit,BTC,BTC,1783929600000,0.55,120,52.4,63100\n";
    const { velo, urls } = client(body);
    const data = await velo.options
      .iv("1m")
      .delta("call", { metric: "coin" })
      .dvol("close")
      .indexPrice()
      .exchanges(["deribit"])
      .coins(["BTC"])
      .between(begin, end)
      .resolution("1h")
      .execute();

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
    expectTypeOf(data).toEqualTypeOf<
      Data<OptionsExchange, "iv_1m" | "call_delta_coins" | "dvol_close" | "index_price">
    >();

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

  it("does not expose terminals on the untouched namespace type", () => {
    const { velo } = client();
    type NamespaceTerminal = Extract<keyof typeof velo.options, "params" | "build" | "execute">;
    expectTypeOf<NamespaceTerminal>().toEqualTypeOf<never>();
  });
});
