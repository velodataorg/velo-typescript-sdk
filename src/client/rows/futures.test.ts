import { describe, expect, it } from "vitest";

import { VeloError } from "../../errors.js";
import { Velo } from "../client.js";
import { FUTURES_COLUMNS, FUTURES_EXCHANGES } from "./futures.js";

const ROWS_CSV =
  "exchange,coin,product,time,close_price,funding_rate\n" +
  "binance-futures,BTC,BTCUSDT,1783929600000,63174.9,0.0001\n" +
  "bybit,BTC,BTCUSDT,1783929600000,null,\n";

function client(body: string, urls: string[] = []) {
  const fetch: typeof globalThis.fetch = async (input) => {
    urls.push(String(input));
    return new Response(body);
  };
  return { velo: new Velo({ apiKey: "test_key", fetch }), urls };
}

function search(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

describe("Velo.futures", () => {
  const params = {
    exchanges: ["binance-futures", "bybit"],
    products: ["BTCUSDT"],
    columns: ["close_price", "funding_rate"],
    begin: Date.UTC(2026, 5, 17, 7, 23, 45),
    end: Date.UTC(2026, 5, 17, 9, 0, 0, 1),
    resolution: "1h",
  } as const;

  it("exposes one stable namespace", () => {
    const { velo } = client("");
    expect(velo.futures).toBe(velo.futures);
  });

  it("is lazy, aligns the range, sends futures type, and decodes requested columns", async () => {
    const { velo, urls } = client(ROWS_CSV);
    const query = velo.futures.query(params);
    expect(urls).toHaveLength(0);

    const rows = await query.execute();
    expect(urls).toHaveLength(1);
    expect(rows).toEqual([
      {
        exchange: "binance-futures",
        coin: "BTC",
        product: "BTCUSDT",
        time: 1783929600000,
        close_price: 63174.9,
        funding_rate: 0.0001,
      },
      {
        exchange: "bybit",
        coin: "BTC",
        product: "BTCUSDT",
        time: 1783929600000,
        close_price: null,
        funding_rate: null,
      },
    ]);

    const sent = search(urls[0] as string);
    expect(sent.get("type")).toBe("futures");
    expect(sent.get("exchanges")).toBe("binance-futures,bybit");
    expect(sent.get("products")).toBe("BTCUSDT");
    expect(sent.get("coins")).toBeNull();
    expect(sent.get("columns")).toBe("close_price,funding_rate");
    expect(sent.get("resolution")).toBe("60");
    expect(sent.get("begin")).toBe(String(Date.UTC(2026, 5, 17, 7)));
    expect(sent.get("end")).toBe(String(Date.UTC(2026, 5, 17, 10)));

    const price: number | null = rows[0]!.close_price;
    const exchange:
      | "binance-futures"
      | "bybit"
      | "deribit"
      | "hyperliquid"
      | "binance-coin-margin"
      | "bybit-coin-margin"
      | "okex-coin-margin"
      | "okex-swap" = rows[0]!.exchange;
    expect(price).toBe(63174.9);
    expect(exchange).toBe("binance-futures");

    // @ts-expect-error only requested columns are present
    expect(rows[0]!.open_price).toBeUndefined();
  });

  it("snapshots caller arrays and freezes query options", async () => {
    const urls: string[] = [];
    const products = ["BTCUSDT"];
    const columns: ("close_price" | "funding_rate")[] = ["close_price", "funding_rate"];
    const query = client(ROWS_CSV, urls).velo.futures.query({
      ...params,
      products,
      columns,
    });

    products.push("ETHUSDT");
    columns.pop();
    expect(() =>
      (query.options.requests[0]!.params.columns as string[]).push("open_price"),
    ).toThrow(TypeError);

    await query.execute();
    expect(search(urls[0] as string).get("products")).toBe("BTCUSDT");
    expect(search(urls[0] as string).get("columns")).toBe("close_price,funding_rate");
  });

  it("supports the BTC/ETH basis query without products or exchanges", async () => {
    const body =
      "exchange,coin,product,time,3m_basis_ann\n" +
      "deribit,BTC,BTC-25SEP26,1783929600000,0.0395\n";
    const { velo, urls } = client(body);
    const rows = await velo.futures
      .query({
        columns: ["3m_basis_ann"],
        coins: ["BTC", "ETH"],
        begin: params.begin,
        end: params.end,
        resolution: "1h",
      })
      .execute();

    expect(rows[0]?.["3m_basis_ann"]).toBe(0.0395);
    const sent = search(urls[0] as string);
    expect(sent.get("coins")).toBe("BTC,ETH");
    expect(sent.get("exchanges")).toBeNull();
    expect(sent.get("products")).toBeNull();
  });

  it("sends calendar-month chunks with months=true", async () => {
    const urls: string[] = [];
    const body = "exchange,coin,product,time,close_price\n";
    await client(body, urls)
      .velo.futures.query({
        exchanges: ["binance-futures"],
        products: ["BTCUSDT"],
        columns: ["close_price"],
        begin: Date.UTC(2026, 0, 15),
        end: Date.UTC(2026, 2, 15),
        resolution: "1M",
      })
      .execute();

    expect(urls).toHaveLength(3);
    expect(search(urls[0] as string).get("months")).toBe("true");
    expect(search(urls[0] as string).get("begin")).toBe(String(Date.UTC(2026, 0, 1)));
    expect(search(urls[0] as string).get("end")).toBe(String(Date.UTC(2026, 1, 1)));
  });

  it("chunks over-budget ranges and concatenates results in request order", async () => {
    const urls: string[] = [];
    const fetch: typeof globalThis.fetch = async (input) => {
      urls.push(String(input));
      const step = urls.length;
      return new Response(
        `exchange,coin,product,time,close_price\nbinance-futures,BTC,BTCUSDT,${step},${step * 10}\n`,
      );
    };
    const begin = Date.UTC(2026, 0, 1);
    const rows = await new Velo({ apiKey: "test_key", fetch }).futures
      .query({
        exchanges: ["binance-futures"],
        products: ["BTCUSDT"],
        columns: ["close_price"],
        begin,
        end: begin + 30_000 * 60_000,
        resolution: "1m",
      })
      .execute();

    expect(urls).toHaveLength(2);
    expect(search(urls[1] as string).get("begin")).toBe(search(urls[0] as string).get("end"));
    expect(rows.map((row) => row.close_price)).toEqual([10, 20]);
  });

  it("rejects invalid params before sending anything", () => {
    const { velo, urls } = client("");
    const invalid: unknown[] = [
      null,
      {},
      { ...params, products: undefined },
      { ...params, coins: ["BTC"] },
      { ...params, exchanges: [] },
      { ...params, columns: [] },
      { ...params, products: [""] },
      { ...params, exchanges: ["coinbase"] },
      { ...params, columns: ["iv_1w"] },
      { ...params, columns: ["close_price", "close_price"] },
      { ...params, begin: -1 },
      { ...params, end: params.begin },
      { ...params, resolution: "3m" },
      { ...params, unexpected: true },
      {
        columns: ["3m_basis_ann"],
        coins: ["SOL"],
        begin: params.begin,
        end: params.end,
        resolution: "1h",
      },
      {
        columns: ["3m_basis_ann"],
        coins: ["BTC"],
        exchanges: ["deribit"],
        begin: params.begin,
        end: params.end,
        resolution: "1h",
      },
    ];

    for (const value of invalid) {
      expect(() => velo.futures.query(value as never)).toThrow(VeloError);
    }
    expect(urls).toHaveLength(0);
  });

  it("accepts empty responses and rejects malformed responses", async () => {
    await expect(client("").velo.futures.query(params).execute()).resolves.toEqual([]);

    for (const body of [
      "exchange,coin,product,time,close_price\nbinance-futures,BTC,BTCUSDT,1,2\n",
      "exchange,coin,product,time,funding_rate,close_price\nbinance-futures,BTC,BTCUSDT,1,2,3\n",
      "exchange,coin,product,time,close_price,funding_rate\nunknown,BTC,BTCUSDT,1,2,3\n",
      "exchange,coin,product,time,close_price,funding_rate\nbinance-futures,BTC,BTCUSDT,-1,2,3\n",
      "exchange,coin,product,time,close_price,funding_rate\nbinance-futures,BTC,BTCUSDT,1.5,2,3\n",
      "exchange,coin,product,time,close_price,funding_rate\nbinance-futures,BTC,BTCUSDT,1,NaN,3\n",
    ]) {
      await expect(client(body).velo.futures.query(params).execute()).rejects.toThrow(
        /Unexpected \/api\/v1\/rows response/,
      );
    }
  });

  it("publishes the futures vocabulary", () => {
    expect(FUTURES_EXCHANGES).toContain("binance-futures");
    expect(FUTURES_COLUMNS).toContain("funding_rate");
    expect(FUTURES_COLUMNS).toContain("3m_basis_ann");
  });
});
