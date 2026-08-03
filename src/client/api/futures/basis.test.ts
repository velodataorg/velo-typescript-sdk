import { describe, expect, it, vi } from "vitest";

import { VeloError } from "../../../errors.js";
import { Velo } from "../../client.js";
import { BASIS_COLUMN } from "../../common/market/columns.js";
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
  const scope = { between: [begin, end], resolution: "1h" } as const;

  it("exposes a dedicated builder and defaults to BTC and ETH", () => {
    const builder = client().velo.futures.basis();
    const params = builder.params(scope);

    expect(params).toEqual({
      columns: ["3m_basis_ann"],
      coins: ["BTC", "ETH"],
      begin,
      end,
      resolution: "1h",
    });
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

    const first = bitcoin.params(scope);
    expect(first).toMatchObject({ coins: ["BTC"], begin, end });
    expect(ethereum.params(scope).coins).toEqual(["ETH"]);
    expect(base.params(scope).coins).toEqual(["BTC", "ETH"]);

    (first.coins as BasisCoin[]).push("ETH");
    expect(bitcoin.params(scope).coins).toEqual(["BTC"]);
  });

  it("rejects incomplete scopes at compile time", () => {
    const { velo } = client();

    /* Never called: these statements pin compile-time rejections only. */
    const compileTimeOnly = () => {
      // @ts-expect-error the scope must set between or last
      velo.futures.basis().params({ resolution: "1h" });
      // @ts-expect-error the scope must set a resolution
      velo.futures.basis().params({ between: [begin, end] });
      // @ts-expect-error the scope cannot set both between and last
      velo.futures.basis().build({ ...scope, last: "2h" });
      // @ts-expect-error a terminal method requires a scope
      velo.futures.basis().fetch();
    };
    void compileTimeOnly;
  });

  it("rejects malformed scopes and delegates the rest to the params schema", () => {
    const { velo } = client();
    const invalid = [
      () => velo.futures.basis().coins([]).params(scope),
      () =>
        velo.futures
          .basis()
          .coins(["SOL" as BasisCoin])
          .params(scope),
      () => velo.futures.basis().params({ ...scope, between: [end, begin] }),
    ];

    for (const lower of invalid) {
      expect(lower).toThrow(VeloError);
      expect(lower).toThrow(/Invalid futures params/);
    }
    expect(() => velo.futures.basis().params({ resolution: "1h" } as never)).toThrow(
      /scope must set between or last/,
    );
    expect(() => velo.futures.basis().params({ between: [begin, end] } as never)).toThrow(
      /scope must set a resolution/,
    );
    expect(() => velo.futures.basis().params({ ...scope, last: "2h" } as never)).toThrow(
      /scope cannot set both between and last/,
    );
    expect(() => velo.futures.basis().params({ last: "0m", resolution: "1h" })).toThrow(VeloError);
    expect(() =>
      velo.futures.basis().params({ last: "1d" as LastDuration, resolution: "1h" }),
    ).toThrow(VeloError);
  });

  it("reads the clock when lowering and fixes it in a built query", async () => {
    vi.useFakeTimers();
    try {
      const urls: string[] = [];
      const { velo } = client("exchange,coin,product,time,3m_basis_ann\n", urls);
      const builder = velo.futures.basis().coins(["BTC"]);
      const trailing = { last: "2h", resolution: "1h" } as const;
      const firstEnd = Date.UTC(2026, 6, 13, 10);
      const secondEnd = firstEnd + 60 * 60_000;

      vi.setSystemTime(firstEnd);
      expect(builder.params(trailing)).toMatchObject({
        begin: firstEnd - 2 * 60 * 60_000,
        end: firstEnd,
      });
      vi.setSystemTime(secondEnd);
      expect(builder.params(trailing)).toMatchObject({
        begin: secondEnd - 2 * 60 * 60_000,
        end: secondEnd,
      });

      vi.setSystemTime(firstEnd);
      const query = builder.build(trailing);
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
      .fetch({ between: [begin, end], resolution: "1h" });

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
});
