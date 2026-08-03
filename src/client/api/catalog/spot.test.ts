import { describe, expect, it } from "vitest";

import { VeloError } from "../../../errors.ts";
import { Velo } from "../../client.ts";
import type { SpotExchange } from "../../common/market/exchanges.ts";

const SPOT_CSV =
  "exchange,coin,product,begin\n" +
  "coinbase,BTC,BTC-USD,1417411980000\n" +
  "binance,ETH,ETHUSDT,1502942428000\n";

const DELISTED_SPOT_CSV =
  "exchange,coin,product,begin,end\n" + "coinbase,BTC,BTC-USD,1417411980000,1764172800000\n";

function client(body: string, urls: string[] = []) {
  const fetch: typeof globalThis.fetch = async (input) => {
    urls.push(String(input));
    return new Response(body);
  };
  return { velo: new Velo({ apiKey: "test_key", fetch }), urls };
}

describe("Velo.catalog.spot", () => {
  it("fetches, searches, and decodes the spot product catalog", async () => {
    const { velo, urls } = client(SPOT_CSV);
    const products = await velo.catalog.spot({
      coin: "btc",
      exchange: "COINBASE" as SpotExchange,
    });

    const url = new URL(urls[0] as string);
    expect(url.pathname).toBe("/api/v1/spot");
    expect(url.searchParams.get("delisted")).toBe("0");
    expect(products).toEqual([
      {
        exchange: "coinbase",
        coin: "BTC",
        product: "BTC-USD",
        begin: 1417411980000,
      },
    ]);
    expect(products[0]).not.toHaveProperty("depth");

    const exchange: SpotExchange = products[0]!.exchange;
    expect(exchange).toBe("coinbase");
  });

  it("selects delisted-only spot products", async () => {
    const { velo, urls } = client(DELISTED_SPOT_CSV);

    const products = await velo.catalog.spot({ delisted: true });

    expect(new URL(urls[0] as string).searchParams.get("delisted")).toBe("1");
    expect(products[0]?.end).toBe(1764172800000);
  });

  it("rejects unsupported depth params before requesting", () => {
    const { velo, urls } = client(SPOT_CSV);

    expect(() => velo.catalog.spot({ depth: true } as never)).toThrow(
      /does not support depth filtering/,
    );
    expect(urls).toHaveLength(0);
  });

  it("rejects invalid spot responses with endpoint context", async () => {
    const invalid = [
      "exchange,coin,product,begin\nunknown,BTC,BTC-USD,1417411980000\n",
      "exchange,coin,product,begin\ncoinbase,BTC,BTC-USD,-1\n",
      "exchange,coin,product,begin,extra\ncoinbase,BTC,BTC-USD,1,x\n",
    ];

    for (const body of invalid) {
      const request = client(body).velo.catalog.spot();
      await expect(request).rejects.toBeInstanceOf(VeloError);
      await expect(request).rejects.toThrow(/Unexpected \/api\/v1\/spot response/);
    }
  });
});
