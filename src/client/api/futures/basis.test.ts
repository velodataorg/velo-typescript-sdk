import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { VeloError } from "../../../errors.js";
import { Velo } from "../../client.js";
import type { Data } from "../../common/data/data.js";
import { BASIS_COLUMN } from "../../common/market/columns.js";
import type { FuturesExchange } from "../../common/market/exchanges.js";
import type { FuturesBasisBuilder } from "./basis.js";
import type { LastDuration } from "./builder.js";
import type { BasisCoin } from "./params.js";

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

describe("futures basis fluent builder", () => {
  const begin = Date.UTC(2026, 6, 13, 8);
  const end = Date.UTC(2026, 6, 13, 10);

  it("exposes a dedicated builder and defaults to BTC and ETH", () => {
    const builder = client().velo.futures.basis();
    const params = builder.between(begin, end).resolution("1h").params();

    expect(params).toEqual({
      columns: ["3m_basis_ann"],
      coins: ["BTC", "ETH"],
      begin,
      end,
      resolution: "1h",
    });
    expectTypeOf(builder).toEqualTypeOf<FuturesBasisBuilder>();
    expectTypeOf(params.columns).toEqualTypeOf<readonly [typeof BASIS_COLUMN]>();
    expectTypeOf<(typeof params.coins)[number]>().toEqualTypeOf<BasisCoin>();
  });

  it("does not expose standard selectors, products, or exchanges", () => {
    const builder = client().velo.futures.basis();
    const unavailable = [
      "price",
      "volume",
      "trades",
      "openInterest",
      "fundingRate",
      "premium",
      "liquidations",
      "liquidationVolume",
      "products",
      "exchanges",
    ] as const;

    for (const method of unavailable) expect(builder).not.toHaveProperty(method);

    type Unavailable = Extract<keyof FuturesBasisBuilder, (typeof unavailable)[number]>;
    expectTypeOf<Unavailable>().toEqualTypeOf<never>();
  });

  it("snapshots inputs, returns fresh params, and supports immutable branching", () => {
    const { velo } = client();
    const coins: BasisCoin[] = ["BTC"];
    const rangeBegin = new Date(begin);
    const rangeEnd = new Date(end);
    const base = velo.futures.basis().between(rangeBegin, rangeEnd).resolution("1h");
    const bitcoin = base.coins(coins);
    const ethereum = base.coins(["ETH"]);

    coins.push("ETH");
    rangeBegin.setTime(begin + 60_000);
    rangeEnd.setTime(end + 60_000);

    const first = bitcoin.params();
    expect(first).toMatchObject({ coins: ["BTC"], begin, end });
    expect(ethereum.params().coins).toEqual(["ETH"]);
    expect(base.params().coins).toEqual(["BTC", "ETH"]);

    (first.coins as BasisCoin[]).push("ETH");
    expect(bitcoin.params().coins).toEqual(["BTC"]);
  });

  it("uses the existing schema for incomplete and invalid chains", () => {
    const { velo } = client();
    const invalid = [
      () => velo.futures.basis().resolution("1h").params(),
      () => velo.futures.basis().between(begin, end).params(),
      () => velo.futures.basis().coins([]).between(begin, end).resolution("1h").params(),
      () =>
        velo.futures
          .basis()
          .coins(["SOL" as BasisCoin])
          .between(begin, end)
          .resolution("1h")
          .params(),
    ];

    for (const lower of invalid) {
      expect(lower).toThrow(VeloError);
      expect(lower).toThrow(/Invalid futures params/);
    }
    expect(() => velo.futures.basis().last("0m")).toThrow(VeloError);
    expect(() => velo.futures.basis().last("1d" as LastDuration)).toThrow(VeloError);
  });

  it("reads the clock when lowering and fixes it in a built query", async () => {
    vi.useFakeTimers();
    try {
      const urls: string[] = [];
      const { velo } = client("exchange,coin,product,time,3m_basis_ann\n", urls);
      const builder = velo.futures.basis().coins(["BTC"]).last("2h").resolution("1h");
      const firstEnd = Date.UTC(2026, 6, 13, 10);
      const secondEnd = firstEnd + 60 * 60_000;

      vi.setSystemTime(firstEnd);
      expect(builder.params()).toMatchObject({ begin: firstEnd - 2 * 60 * 60_000, end: firstEnd });
      vi.setSystemTime(secondEnd);
      expect(builder.params()).toMatchObject({
        begin: secondEnd - 2 * 60 * 60_000,
        end: secondEnd,
      });

      vi.setSystemTime(firstEnd);
      const query = builder.build();
      vi.setSystemTime(secondEnd);
      await query.execute();
      vi.setSystemTime(secondEnd + 60 * 60_000);
      await query.execute();

      expect(search(urls[0]!).get("end")).toBe(String(firstEnd));
      expect(search(urls[1]!).get("end")).toBe(String(firstEnd));
    } finally {
      vi.useRealTimers();
    }
  });

  it("executes through the basis query contract and decodes typed data", async () => {
    const body =
      "exchange,coin,product,time,3m_basis_ann\n" +
      "deribit,BTC,BTC-25SEP26,1783929600000,0.0395\n";
    const { velo, urls } = client(body);
    const data = await velo.futures
      .basis()
      .coins(["BTC"])
      .between(begin, end)
      .resolution("1h")
      .execute();

    expect(data.rows()[0]?.[BASIS_COLUMN]).toBe(0.0395);
    expectTypeOf(data).toEqualTypeOf<Data<FuturesExchange, typeof BASIS_COLUMN>>();

    const sent = search(urls[0]!);
    expect(sent.get("type")).toBe("futures");
    expect(sent.get("coins")).toBe("BTC");
    expect(sent.get("columns")).toBe(BASIS_COLUMN);
    expect(sent.get("exchanges")).toBeNull();
    expect(sent.get("products")).toBeNull();
    expect(sent.get("begin")).toBe(String(begin));
    expect(sent.get("end")).toBe(String(end));
    expect(sent.get("resolution")).toBe("60");
  });
});
