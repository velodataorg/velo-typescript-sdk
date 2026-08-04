import { describe, expect, it, vi } from "vitest";

import { VeloError } from "../../../errors.ts";
import { Velo } from "../../client.ts";
import { FUTURES_COLUMNS } from "../../common/market/columns.ts";
import type { FuturesStandardColumn } from "../../common/market/columns.ts";
import { FUTURES_EXCHANGES, type FuturesExchange } from "../../common/market/exchanges.ts";
import type { FuturesStandardParams } from "./params.ts";

const ROWS_CSV =
  "exchange,coin,product,time,close_price,funding_rate\n" +
  "binance-futures,BTC,BTCUSDT,1783929600000,63174.9,0.0001\n" +
  "bybit,BTC,BTCUSDT,1783929600000,null,\n" +
  "bybit,BTC,BTCUSDT,1783933200000,NaN,undefined\n";

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

function queryRows<C extends FuturesStandardColumn, E extends FuturesExchange>(
  velo: Velo,
  params: FuturesStandardParams<C, E>,
) {
  return velo.query({ kind: "futures.rows", params });
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
    const query = velo.query({ kind: "futures.rows", params });
    expect(urls).toHaveLength(0);

    const rows = (await query).rows();
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
      {
        exchange: "bybit",
        coin: "BTC",
        product: "BTCUSDT",
        time: 1783933200000,
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
    const exchange: "binance-futures" | "bybit" = rows[0]!.exchange;
    expect(price).toBe(63174.9);
    expect(exchange).toBe("binance-futures");

    // @ts-expect-error only requested columns are present
    expect(rows[0]!.open_price).toBeUndefined();
  });

  it("snapshots caller arrays and freezes query options", async () => {
    const urls: string[] = [];
    const products = ["BTCUSDT"];
    const columns: ("close_price" | "funding_rate")[] = ["close_price", "funding_rate"];
    const query = queryRows(client(ROWS_CSV, urls).velo, {
      ...params,
      products,
      columns,
    });

    products.push("ETHUSDT");
    columns.pop();
    expect(() =>
      (query.options.requests[0]!.params.columns as string[]).push("open_price"),
    ).toThrow(TypeError);

    await query;
    expect(search(urls[0] as string).get("products")).toBe("BTCUSDT");
    expect(search(urls[0] as string).get("columns")).toBe("close_price,funding_rate");
  });

  it("supports the BTC/ETH basis query without products or exchanges", async () => {
    const body =
      "exchange,coin,product,time,3m_basis_ann\n" +
      "deribit,BTC,BTC-25SEP26,1783929600000,0.0395\n";
    const { velo, urls } = client(body);
    const data = await velo.query({
      kind: "futures.basis",
      params: {
        columns: ["3m_basis_ann"],
        coins: ["BTC", "ETH"],
        begin: params.begin,
        end: params.end,
        resolution: "1h",
      },
    });

    expect(data.rows()[0]?.["3m_basis_ann"]).toBe(0.0395);
    const sent = search(urls[0] as string);
    expect(sent.get("coins")).toBe("BTC,ETH");
    expect(sent.get("exchanges")).toBeNull();
    expect(sent.get("products")).toBeNull();
  });

  it("sends calendar-month chunks with months=true", async () => {
    const urls: string[] = [];
    const body = "exchange,coin,product,time,close_price\n";
    await queryRows(client(body, urls).velo, {
      exchanges: ["binance-futures"],
      products: ["BTCUSDT"],
      columns: ["close_price"],
      begin: Date.UTC(2026, 0, 15),
      end: Date.UTC(2026, 2, 15),
      resolution: "1M",
    });

    expect(urls).toHaveLength(3);
    expect(search(urls[0] as string).get("months")).toBe("true");
    expect(search(urls[0] as string).get("begin")).toBe(String(Date.UTC(2026, 0, 1)));
    expect(search(urls[0] as string).get("end")).toBe(String(Date.UTC(2026, 1, 1)));
  });

  it("clamps ends aligned into the future at the current time", async () => {
    vi.useFakeTimers();
    try {
      // A Tuesday, so 1W ceils to the next Monday and 1M to the next month.
      const now = Date.UTC(2026, 6, 28, 14, 30);
      vi.setSystemTime(now);
      const base = {
        exchanges: ["binance-futures"],
        products: ["BTCUSDT"],
        columns: ["close_price"],
      } as const;

      const weekly: string[] = [];
      await queryRows(client("", weekly).velo, {
        ...base,
        begin: Date.UTC(2026, 6, 1),
        end: now,
        resolution: "1W",
      });
      expect(weekly).toHaveLength(1);
      expect(search(weekly[0] as string).get("begin")).toBe(String(Date.UTC(2026, 5, 29)));
      expect(search(weekly[0] as string).get("end")).toBe(String(now));

      const monthly: string[] = [];
      await queryRows(client("", monthly).velo, {
        ...base,
        begin: Date.UTC(2026, 5, 15),
        end: now,
        resolution: "1M",
      });
      expect(monthly).toHaveLength(2);
      expect(search(monthly[1] as string).get("begin")).toBe(String(Date.UTC(2026, 6, 1)));
      expect(search(monthly[1] as string).get("end")).toBe(String(now));
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a range that is entirely in the future before sending anything", () => {
    vi.useFakeTimers();
    try {
      const now = Date.UTC(2026, 6, 28, 14, 30);
      vi.setSystemTime(now);
      const { velo, urls } = client("");

      // 1W floors the future begin back to a past Monday; the requested
      // begin decides, so this must still be rejected rather than clamped.
      const query = () =>
        queryRows(velo, {
          exchanges: ["binance-futures"],
          products: ["BTCUSDT"],
          columns: ["close_price"],
          begin: now + 24 * 60 * 60_000,
          end: now + 3 * 24 * 60 * 60_000,
          resolution: "1W",
        });

      expect(query).toThrow(VeloError);
      expect(query).toThrow(/entirely in the future/);
      expect(urls).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
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
    const data = await queryRows(new Velo({ apiKey: "test_key", fetch }), {
      exchanges: ["binance-futures"],
      products: ["BTCUSDT"],
      columns: ["close_price"],
      begin,
      end: begin + 30_000 * 60_000,
      resolution: "1m",
    });

    expect(urls).toHaveLength(2);
    expect(search(urls[1] as string).get("begin")).toBe(search(urls[0] as string).get("end"));
    expect(data.rows().map((row) => row.close_price)).toEqual([10, 20]);
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
      expect(() => velo.query({ kind: "futures.rows", params: value } as never)).toThrow(VeloError);
    }
    expect(urls).toHaveLength(0);
  });

  it("accepts empty responses and rejects malformed responses", async () => {
    const empty = await queryRows(client("").velo, params);
    expect(empty.rows()).toEqual([]);

    for (const body of [
      "exchange,coin,product,time,close_price\nbinance-futures,BTC,BTCUSDT,1,2\n",
      "exchange,coin,product,time,funding_rate,close_price\nbinance-futures,BTC,BTCUSDT,1,2,3\n",
      "exchange,coin,product,time,close_price,funding_rate\nunknown,BTC,BTCUSDT,1,2,3\n",
      "exchange,coin,product,time,close_price,funding_rate\nbinance-futures,BTC,BTCUSDT,-1,2,3\n",
      "exchange,coin,product,time,close_price,funding_rate\nbinance-futures,BTC,BTCUSDT,1.5,2,3\n",
      "exchange,coin,product,time,close_price,funding_rate\nbinance-futures,BTC,BTCUSDT,NaN,2,3\n",
    ]) {
      await expect(queryRows(client(body).velo, params)).rejects.toThrow(
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
