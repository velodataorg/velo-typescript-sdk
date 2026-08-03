import { describe, expect, it } from "vitest";

import { VeloError } from "../../../errors.ts";
import { Velo } from "../../client.ts";
import type { OptionsExchange } from "../../common/market/exchanges.ts";

const OPTIONS_CSV =
  "exchange,coin,product,begin\n" +
  "deribit,BTC,BTC,1617206400000\n" +
  "deribit,ETH,ETH,1617206400000\n";

function client(body: string, urls: string[] = []) {
  const fetch: typeof globalThis.fetch = async (input) => {
    urls.push(String(input));
    return new Response(body);
  };
  return { velo: new Velo({ apiKey: "test_key", fetch }), urls };
}

describe("Velo.catalog.options", () => {
  it("fetches, searches, and decodes the options product catalog", async () => {
    const { velo, urls } = client(OPTIONS_CSV);
    const products = await velo.catalog.options({ product: "btc" });

    const url = new URL(urls[0] as string);
    expect(url.pathname).toBe("/api/v1/options");
    expect(url.searchParams.get("delisted")).toBe("0");
    expect(products).toEqual([
      {
        exchange: "deribit",
        coin: "BTC",
        product: "BTC",
        begin: 1617206400000,
      },
    ]);

    const exchange: OptionsExchange = products[0]!.exchange;
    expect(exchange).toBe("deribit");
  });

  it("rejects unsupported delisted params before requesting", () => {
    const { velo, urls } = client(OPTIONS_CSV);

    expect(() => velo.catalog.options({ delisted: true } as never)).toThrow(
      /does not support delisted products/,
    );
    expect(urls).toHaveLength(0);
  });

  it("rejects unsupported depth params before requesting", () => {
    const { velo, urls } = client(OPTIONS_CSV);

    expect(() => velo.catalog.options({ depth: true } as never)).toThrow(
      /does not support depth filtering/,
    );
    expect(urls).toHaveLength(0);
  });

  it("rejects invalid options responses with endpoint context", async () => {
    const invalid = [
      "exchange,coin,product,begin\nunknown,BTC,BTC,1617206400000\n",
      "exchange,coin,product,begin\nderibit,,BTC,1617206400000\n",
      "exchange,coin,product,begin\nderibit,BTC,BTC,nope\n",
    ];

    for (const body of invalid) {
      const request = client(body).velo.catalog.options();
      await expect(request).rejects.toBeInstanceOf(VeloError);
      await expect(request).rejects.toThrow(/Unexpected \/api\/v1\/options response/);
    }
  });
});
