import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { VeloError } from "../../../errors.ts";
import { Velo } from "../../client.ts";
import type { DataResult } from "../../data/data.ts";
import { BASIS_COLUMN } from "../../market/columns.ts";
import type { FuturesExchange } from "../../market/exchanges.ts";
import type { QueryRequest } from "../../query/plan.ts";
import type { FuturesBasisBuilder } from "./basis.ts";
import type { LastDuration } from "./builder.ts";
import type { BasisCoin, FuturesRow } from "./params.ts";

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
  const scope = { between: [begin, end], resolution: "1h" } as const;

  it("exposes a dedicated builder and defaults to BTC and ETH", () => {
    const builder = client().velo.futures.basis().over(scope);
    const params = builder.params();

    expect(params).toEqual({
      columns: ["3m_basis_ann"],
      coins: ["BTC", "ETH"],
      begin,
      end,
      resolution: "1h",
    });
    expectTypeOf(builder).toEqualTypeOf<FuturesBasisBuilder<"over">>();
  });

  it("does not expose standard selectors, products, exchanges, or scope methods", () => {
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
      "between",
      "last",
      "resolution",
    ] as const;

    for (const method of unavailable) expect(builder).not.toHaveProperty(method);
  });

  it("snapshots inputs, returns fresh params, and supports immutable branching", () => {
    const { velo } = client();
    const coins: BasisCoin[] = ["BTC"];
    const base = velo.futures.basis();
    const bitcoin = base.coins(coins);
    const ethereum = base.coins(["ETH"]);

    coins.push("ETH");

    const first = bitcoin.over(scope).params();
    expect(first).toMatchObject({ coins: ["BTC"], begin, end });
    expect(ethereum.over(scope).params().coins).toEqual(["ETH"]);
    expect(base.over(scope).params().coins).toEqual(["BTC", "ETH"]);

    (first.coins as BasisCoin[]).push("ETH");
    expect(bitcoin.over(scope).params().coins).toEqual(["BTC"]);
  });

  it("rejects incomplete scopes at compile time", () => {
    const { velo } = client();

    /* Never called: these statements pin compile-time rejections only. */
    const compileTimeOnly = () => {
      // @ts-expect-error the scope must set between or last
      velo.futures.basis().over({ resolution: "1h" });
      // @ts-expect-error the scope must set a resolution
      velo.futures.basis().over({ between: [begin, end] });
      // @ts-expect-error the scope cannot set both between and last
      velo.futures.basis().over({ ...scope, last: "2h" });
      // @ts-expect-error incomplete builders cannot be passed to the central query pipeline
      velo.query(velo.futures.basis());
    };
    void compileTimeOnly;
  });

  it("rejects malformed scopes and delegates the rest to the params schema", () => {
    const { velo } = client();
    const invalid = [
      () => velo.futures.basis().coins([]).over(scope).params(),
      () =>
        velo.futures
          .basis()
          .coins(["SOL" as BasisCoin])
          .over(scope)
          .params(),
      () =>
        velo.futures
          .basis()
          .over({ ...scope, between: [end, begin] })
          .params(),
    ];

    for (const lower of invalid) {
      expect(lower).toThrow(VeloError);
      expect(lower).toThrow(/Invalid futures params/);
    }
    expect(() => velo.futures.basis().over({ resolution: "1h" } as never)).toThrow(
      /scope must set between or last/,
    );
    expect(() => velo.futures.basis().over({ between: [begin, end] } as never)).toThrow(
      /scope must set a resolution/,
    );
    expect(() => velo.futures.basis().over({ ...scope, last: "2h" } as never)).toThrow(
      /scope cannot set both between and last/,
    );
    expect(() => velo.futures.basis().over({ last: "0m", resolution: "1h" })).toThrow(VeloError);
    expect(() =>
      velo.futures.basis().over({ last: "1d" as LastDuration, resolution: "1h" }),
    ).toThrow(VeloError);
  });

  it("reads the clock when lowering and fixes it in a built query", async () => {
    vi.useFakeTimers();
    try {
      const urls: string[] = [];
      const { velo } = client("exchange,coin,product,time,3m_basis_ann\n", urls);
      const trailing = { last: "2h", resolution: "1h" } as const;
      const builder = velo.futures.basis().coins(["BTC"]).over(trailing);
      const firstEnd = Date.UTC(2026, 6, 13, 10);
      const secondEnd = firstEnd + 60 * 60_000;

      vi.setSystemTime(firstEnd);
      expect(builder.params()).toMatchObject({
        begin: firstEnd - 2 * 60 * 60_000,
        end: firstEnd,
      });
      vi.setSystemTime(secondEnd);
      expect(builder.params()).toMatchObject({
        begin: secondEnd - 2 * 60 * 60_000,
        end: secondEnd,
      });

      vi.setSystemTime(firstEnd);
      const query = velo.query(builder.build());
      vi.setSystemTime(secondEnd);
      const first = await query;
      vi.setSystemTime(secondEnd + 60 * 60_000);
      const second = await query;

      expect(search(urls[0]!).get("end")).toBe(String(firstEnd));
      expect(urls).toHaveLength(1);
      expect(second).toBe(first);
    } finally {
      vi.useRealTimers();
    }
  });

  it("executes through the basis query contract and decodes typed data", async () => {
    const body =
      "exchange,coin,product,time,3m_basis_ann\n" +
      "deribit,BTC,BTC-25SEP26,1783929600000,0.0395\n";
    const { velo, urls } = client(body);
    const data = await velo.query(
      velo.futures
        .basis()
        .coins(["BTC"])
        .over({ between: [begin, end], resolution: "1h" }),
    );

    expect(data.rows()[0]?.[BASIS_COLUMN]).toBe(0.0395);

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

  it("streams decoded basis rows through the central query pipeline", async () => {
    const body =
      "exchange,coin,product,time,3m_basis_ann\n" +
      "deribit,BTC,BTC-25SEP26,1783929600000,0.0395\n";
    const { velo, urls } = client(body);
    const rows: FuturesRow<typeof BASIS_COLUMN>[] = [];

    const request = velo.futures.basis().coins(["BTC"]).over(scope);
    for await (const row of velo.stream(request)) {
      rows.push(row);
    }

    expect(rows).toEqual([
      {
        exchange: "deribit",
        coin: "BTC",
        product: "BTC-25SEP26",
        time: 1783929600000,
        [BASIS_COLUMN]: 0.0395,
      },
    ]);
    expect(urls).toHaveLength(1);
  });

  it("builds a frozen request and preserves central query inference", () => {
    const { velo } = client();
    const builder = velo.futures.basis().coins(["BTC"]).over(scope);
    const request = builder.build();
    const query = velo.query(builder);

    expect(request.kind).toBe("futures.basis");
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.params)).toBe(true);
    expect(Object.isFrozen(request.params.coins)).toBe(true);
    expectTypeOf(request).toEqualTypeOf<QueryRequest<"futures.basis">>();
    expectTypeOf(query).toEqualTypeOf<Promise<DataResult<FuturesExchange, typeof BASIS_COLUMN>>>();
  });
});
