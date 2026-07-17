import { describe, expect, it } from "vitest";

import { VeloError, VeloRateLimitError } from "../../errors.js";
import { Velo } from "../client.js";
import type { FuturesExchange, SpotExchange } from "../rows/types.js";
import type { CatalogSearchParams } from "./catalog.js";

const FUTURES_CSV =
  "exchange,coin,product,begin,depth\n" +
  "hyperliquid,BTC,BTC-USD,1718136000000,true\n" +
  "binance-futures,BTC,BTCUSDT,1502942428000,false\n" +
  "bybit,ETH,ETHUSDT,1614589200000,false\n";

const SPOT_CSV =
  "exchange,coin,product,begin\n" +
  "coinbase,BTC,BTC-USD,1417411980000\n" +
  "binance,ETH,ETHUSDT,1502942428000\n";

const validSearches: CatalogSearchParams[] = [
  {},
  { coin: "BTC" },
  { product: "BTCUSDT" },
  { exchange: "binance-futures" },
  { coin: "BTC", exchange: "hyperliquid" },
  { product: "BTCUSDT", exchange: "binance-futures" },
];
void validSearches;

// @ts-expect-error coin and product are mutually exclusive
const invalidSearch: CatalogSearchParams = { coin: "BTC", product: "BTCUSDT" };
void invalidSearch;

/** A Velo client whose fetch returns `body` and records request URLs. */
function velo(body: string, urls: string[] = []) {
  const fetchFn: typeof globalThis.fetch = async (input) => {
    urls.push(String(input));
    return new Response(body, { status: 200 });
  };
  return { velo: new Velo({ apiKey: "test_key", fetch: fetchFn }), urls };
}

describe("Velo.catalog", () => {
  it("exposes one stable catalog namespace", () => {
    const { velo: client } = velo("");
    expect(client.catalog).toBe(client.catalog);
  });
});

describe("Velo.catalog.futures", () => {
  it("fetches active futures and decodes their exact shape", async () => {
    const { velo: client, urls } = velo(FUTURES_CSV);
    const rows = await client.catalog.futures();

    expect(new URL(urls[0] as string).pathname).toBe("/api/v1/futures");
    expect(new URL(urls[0] as string).searchParams.get("delisted")).toBe("0");
    expect(rows).toEqual([
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

    const exchange: FuturesExchange = rows[0]!.exchange;
    const depth: boolean = rows[0]!.depth;
    expect(exchange).toBe("hyperliquid");
    expect(depth).toBe(true);
  });

  it("searches by either selector and optionally by exchange, case-insensitively", async () => {
    const { velo: client, urls } = velo(FUTURES_CSV);

    await expect(client.catalog.futures({ coin: "btc" })).resolves.toHaveLength(2);
    await expect(client.catalog.futures({ product: "btcusdt" })).resolves.toEqual([
      expect.objectContaining({ exchange: "binance-futures", product: "BTCUSDT" }),
    ]);
    await expect(client.catalog.futures({ exchange: "BINANCE-FUTURES" })).resolves.toEqual([
      expect.objectContaining({ exchange: "binance-futures" }),
    ]);
    await expect(client.catalog.futures({ coin: "BTC", exchange: "HYPERLIQUID" })).resolves.toEqual(
      [expect.objectContaining({ product: "BTC-USD" })],
    );
    await expect(
      client.catalog.futures({ product: "BTCUSDT", exchange: "BINANCE-FUTURES" }),
    ).resolves.toEqual([expect.objectContaining({ coin: "BTC" })]);
    await expect(client.catalog.futures({ product: "missing" })).resolves.toEqual([]);

    // Every search is fresh; filters are local and only delisted is sent.
    expect(urls).toHaveLength(6);
    for (const raw of urls) {
      const url = new URL(raw);
      expect(Array.from(url.searchParams.keys())).toEqual(["delisted"]);
    }
  });

  it("validates params synchronously before sending a request", () => {
    const { velo: client, urls } = velo(FUTURES_CSV);
    const invalid: unknown[] = [
      null,
      [],
      "BTC",
      { coin: "", exchange: "binance-futures" },
      { product: "" },
      { exchange: "" },
      { coin: 1 },
      { product: false },
      { exchange: Symbol("exchange") },
      { coin: "BTC", product: "BTCUSDT" },
    ];

    for (const params of invalid) {
      expect(() => client.catalog.futures(params as never)).toThrow(VeloError);
    }
    expect(urls).toHaveLength(0);
  });

  it("preserves row order and duplicates and accepts empty responses", async () => {
    const duplicate =
      "exchange,coin,product,begin,depth\n" +
      "bybit,ETH,ETHUSDT,1614589200000,false\n" +
      "hyperliquid,BTC,BTC-USD,1718136000000,true\n" +
      "hyperliquid,BTC,BTC-USD,1718136000000,true\n";
    const { velo: client } = velo(duplicate);
    const rows = await client.catalog.futures();
    expect(rows.map((row) => row.product)).toEqual(["ETHUSDT", "BTC-USD", "BTC-USD"]);

    await expect(velo("").velo.catalog.futures()).resolves.toEqual([]);
    await expect(
      velo("exchange,coin,product,begin,depth\n").velo.catalog.futures(),
    ).resolves.toEqual([]);
  });

  it("rejects invalid futures responses", async () => {
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
      await expect(velo(body).velo.catalog.futures()).rejects.toBeInstanceOf(VeloError);
    }
  });

  it("forwards cancellation, timeout, and retry options", async () => {
    let aborted = false;
    const controller = new AbortController();
    controller.abort();
    const signalClient = new Velo({
      apiKey: "test_key",
      fetch: async (_input, init) => {
        aborted = init?.signal?.aborted ?? false;
        return new Response(FUTURES_CSV, { status: 200 });
      },
    });
    await signalClient.catalog.futures(undefined, { signal: controller.signal });
    expect(aborted).toBe(true);

    let timeoutCalls = 0;
    const timeoutClient = new Velo({
      apiKey: "test_key",
      fetch: async () => {
        timeoutCalls++;
        return new Response(FUTURES_CSV, { status: 200 });
      },
    });
    await expect(timeoutClient.catalog.futures(undefined, { timeout: 0 })).rejects.toThrow(
      /timeout/,
    );
    expect(timeoutCalls).toBe(0);

    let retryCalls = 0;
    const retryClient = new Velo({
      apiKey: "test_key",
      fetch: async () => {
        retryCalls++;
        return new Response("rate limited", { status: 429 });
      },
    });
    await expect(
      retryClient.catalog.futures(undefined, { retry: { retries: 0 } }),
    ).rejects.toBeInstanceOf(VeloRateLimitError);
    expect(retryCalls).toBe(1);
  });
});

describe("Velo.catalog.spot", () => {
  it("fetches active spot products and searches the four-field shape", async () => {
    const { velo: client, urls } = velo(SPOT_CSV);
    const rows = await client.catalog.spot({ coin: "btc", exchange: "COINBASE" });

    const url = new URL(urls[0] as string);
    expect(url.pathname).toBe("/api/v1/spot");
    expect(url.searchParams.get("delisted")).toBe("0");
    expect(rows).toEqual([
      {
        exchange: "coinbase",
        coin: "BTC",
        product: "BTC-USD",
        begin: 1417411980000,
      },
    ]);
    expect(rows[0]).not.toHaveProperty("depth");

    const exchange: SpotExchange = rows[0]!.exchange;
    expect(exchange).toBe("coinbase");
  });

  it("rejects unknown spot exchanges and invalid timestamps", async () => {
    await expect(
      velo("exchange,coin,product,begin\nunknown,BTC,BTC-USD,1417411980000\n").velo.catalog.spot(),
    ).rejects.toThrow(/unknown exchange/);
    await expect(
      velo("exchange,coin,product,begin\ncoinbase,BTC,BTC-USD,-1\n").velo.catalog.spot(),
    ).rejects.toThrow(/begin must be a nonnegative safe integer/);
  });
});
