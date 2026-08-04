import { describe, expect, expectTypeOf, it } from "vitest";

import { VeloError, VeloRateLimitError } from "../../../errors.ts";
import { Velo } from "../../client.ts";
import type { FuturesExchange } from "../../common/market/exchanges.ts";
import type { Query } from "../../common/query.ts";
import type { QueryRequest } from "../../plan.ts";
import type { FutureProduct, FuturesCatalogParams } from "./futures.ts";

const FUTURES_CSV =
  "exchange,coin,product,begin,depth\n" +
  "hyperliquid,BTC,BTC-USD,1718136000000,true\n" +
  "binance-futures,BTC,BTCUSDT,1502942428000,false\n" +
  "bybit,ETH,ETHUSDT,1614589200000,false\n";

const DELISTED_FUTURES_CSV =
  "exchange,coin,product,begin,end,depth\n" +
  "binance-futures,BTC,BTCUSD_210625,1615334400000,1624608000000,false\n";

function client(body: string, urls: string[] = []) {
  const fetch: typeof globalThis.fetch = async (input) => {
    urls.push(String(input));
    return new Response(body);
  };
  return { velo: new Velo({ apiKey: "test_key", fetch }), urls };
}

function futures(velo: Velo, params: FuturesCatalogParams = {}) {
  return velo.query(velo.catalog.futures(params));
}

describe("Velo.catalog.futures", () => {
  it("fetches the active futures catalog and decodes its exact shape", async () => {
    const { velo, urls } = client(FUTURES_CSV);
    const builder = velo.catalog.futures();
    const request = builder.build();
    const query = velo.query(builder);

    expect(urls).toHaveLength(0);
    expect(request.kind).toBe("catalog.futures");
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.params)).toBe(true);
    expect(builder.build()).toBe(request);
    expectTypeOf(request).toEqualTypeOf<QueryRequest<"catalog.futures">>();
    expectTypeOf(query).toEqualTypeOf<Query<FutureProduct, FutureProduct[]>>();

    const products = await query;

    const url = new URL(urls[0] as string);
    expect(url.pathname).toBe("/api/v1/futures");
    expect(url.searchParams.get("delisted")).toBe("0");
    expect(products).toEqual([
      {
        exchange: "hyperliquid",
        coin: "BTC",
        product: "BTC-USD",
        begin: 1718136000000,
        depth: true,
      },
      {
        exchange: "binance-futures",
        coin: "BTC",
        product: "BTCUSDT",
        begin: 1502942428000,
        depth: false,
      },
      {
        exchange: "bybit",
        coin: "ETH",
        product: "ETHUSDT",
        begin: 1614589200000,
        depth: false,
      },
    ]);

    const exchange: FuturesExchange = products[0]!.exchange;
    const depth: boolean = products[0]!.depth;
    expect(exchange).toBe("hyperliquid");
    expect(depth).toBe(true);
  });

  it("searches locally and case-insensitively without sending selectors", async () => {
    const { velo, urls } = client(FUTURES_CSV);

    await expect(futures(velo, { coin: "btc" })).resolves.toHaveLength(2);
    await expect(futures(velo, { product: "btcusdt" })).resolves.toEqual([
      expect.objectContaining({ exchange: "binance-futures", product: "BTCUSDT" }),
    ]);
    await expect(
      futures(velo, { exchange: "BINANCE-FUTURES" as FuturesExchange }),
    ).resolves.toEqual([expect.objectContaining({ exchange: "binance-futures" })]);
    await expect(
      futures(velo, {
        coin: "BTC",
        exchange: "HYPERLIQUID" as FuturesExchange,
      }),
    ).resolves.toEqual([expect.objectContaining({ product: "BTC-USD" })]);
    await expect(futures(velo, { product: "missing" })).resolves.toEqual([]);

    expect(urls).toHaveLength(5);
    for (const raw of urls) {
      expect(Array.from(new URL(raw).searchParams.keys())).toEqual(["delisted"]);
    }
  });

  it("filters on depth locally without sending it", async () => {
    const { velo, urls } = client(FUTURES_CSV);

    await expect(futures(velo, { depth: true })).resolves.toEqual([
      expect.objectContaining({ product: "BTC-USD", depth: true }),
    ]);
    await expect(futures(velo, { depth: false })).resolves.toHaveLength(2);
    await expect(futures(velo, { coin: "BTC", depth: false })).resolves.toEqual([
      expect.objectContaining({ product: "BTCUSDT" }),
    ]);

    expect(urls).toHaveLength(3);
    for (const raw of urls) {
      expect(Array.from(new URL(raw).searchParams.keys())).toEqual(["delisted"]);
    }
  });

  it("selects the delisted-only catalog", async () => {
    const { velo, urls } = client(DELISTED_FUTURES_CSV);

    const products = await futures(velo, { delisted: true });

    expect(new URL(urls[0] as string).searchParams.get("delisted")).toBe("1");
    expect(products[0]?.end).toBe(1624608000000);
    const end: number | undefined = products[0]!.end;
    expect(end).toBeGreaterThan(products[0]!.begin);
  });

  it("validates params synchronously before sending a request", () => {
    const { velo, urls } = client(FUTURES_CSV);
    const invalid: unknown[] = [
      null,
      [],
      { coin: "" },
      { product: "" },
      { coin: "BTC", product: "BTCUSDT" },
      { exchange: "coinbase" },
      { delisted: "true" },
      { depth: "true" },
      { unexpected: true },
    ];

    for (const params of invalid) {
      expect(() => velo.catalog.futures(params as never)).toThrow(VeloError);
    }
    expect(() =>
      velo.query({ kind: "catalog.futures", params: { coin: "", product: undefined } } as never),
    ).toThrow(VeloError);
    expect(urls).toHaveLength(0);
  });

  it("preserves order and duplicates and accepts empty responses", async () => {
    const duplicate =
      "exchange,coin,product,begin,depth\n" +
      "bybit,ETH,ETHUSDT,1614589200000,false\n" +
      "hyperliquid,BTC,BTC-USD,1718136000000,true\n" +
      "hyperliquid,BTC,BTC-USD,1718136000000,true\n";
    const products = await futures(client(duplicate).velo);

    expect(products.map((product) => product.product)).toEqual(["ETHUSDT", "BTC-USD", "BTC-USD"]);
    await expect(futures(client("").velo)).resolves.toEqual([]);
    await expect(futures(client("exchange,coin,product,begin,depth\n").velo)).resolves.toEqual([]);
  });

  it("rejects malformed response headers and values with endpoint context", async () => {
    const invalid = [
      "exchange,coin,product,begin\nhyperliquid,BTC,BTC-USD,1718136000000\n",
      "exchange,coin,product,begin,depth\nunknown,BTC,BTC-USD,1718136000000,true\n",
      "exchange,coin,product,begin,depth\nhyperliquid,BTC,BTC-USD,nope,true\n",
      "exchange,coin,product,begin,depth\nhyperliquid,BTC,BTC-USD,-1,true\n",
      "exchange,coin,product,begin,depth\nhyperliquid,BTC,BTC-USD,1.5,true\n",
      "exchange,coin,product,begin,depth\nhyperliquid,BTC,BTC-USD,9007199254740992,true\n",
      "exchange,coin,product,begin,depth\nhyperliquid,BTC,BTC-USD,1718136000000,TRUE\n",
    ];

    for (const body of invalid) {
      const request = futures(client(body).velo);
      await expect(request).rejects.toBeInstanceOf(VeloError);
      await expect(request).rejects.toThrow(/Unexpected \/api\/v1\/futures response/);
    }
  });

  it("requires a valid end timestamp in delisted responses", async () => {
    const invalid = [
      "exchange,coin,product,begin,depth\nbinance-futures,BTC,BTCUSD_210625,1,false\n",
      "exchange,coin,product,begin,end,depth\nbinance-futures,BTC,BTCUSD_210625,1,-1,false\n",
    ];

    for (const body of invalid) {
      await expect(futures(client(body).velo, { delisted: true })).rejects.toThrow(
        /Unexpected \/api\/v1\/futures response/,
      );
    }
  });

  it("forwards per-request transport options", async () => {
    let calls = 0;
    const velo = new Velo({
      apiKey: "test_key",
      fetch: async () => {
        calls++;
        return new Response("rate limited", { status: 429 });
      },
    });

    await expect(
      velo.query(velo.catalog.futures(), { retry: { retries: 0 } }),
    ).rejects.toBeInstanceOf(VeloRateLimitError);
    expect(calls).toBe(1);
  });

  it("streams locally filtered futures products", async () => {
    const { velo, urls } = client(FUTURES_CSV);
    const products: FutureProduct[] = [];

    for await (const product of futures(velo, { coin: "BTC", depth: true }).stream()) {
      products.push(product);
    }

    expect(products.map((product) => product.product)).toEqual(["BTC-USD"]);
    expect(new URL(urls[0]!).searchParams.has("depth")).toBe(false);
  });
});
