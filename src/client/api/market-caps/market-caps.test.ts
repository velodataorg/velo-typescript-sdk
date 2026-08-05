import { describe, expect, expectTypeOf, it } from "vitest";

import { VeloError } from "../../../errors.ts";
import { Velo } from "../../client.ts";
import type { QueryRequest } from "../../query/plan.ts";
import type { MarketCapsParams } from "./params.ts";
import { MARKET_CAPS_COLUMNS, type MarketCap } from "./validation.ts";

const MARKET_CAPS_CSV =
  "coin,time,circ,circ_dollars,fdv,fdv_dollars\n" +
  "BTC,1783513513252,20053612,1248112746545.6,20053612,1248112746545.6\n" +
  "ETH,1783513513252,,null,120000000,300000000000\n";

function client(body: string, urls: string[] = []) {
  const fetch: typeof globalThis.fetch = async (input) => {
    urls.push(String(input));
    return new Response(body);
  };

  return {
    velo: new Velo({ apiKey: "test_key", fetch }),
    urls,
  };
}

function history(velo: Velo, params: MarketCapsParams) {
  return velo.query(velo.marketCaps.history(params));
}

describe("Velo.marketCaps", () => {
  it("exposes one stable market-caps endpoint", () => {
    const { velo } = client("");
    expect(velo.marketCaps).toBe(velo.marketCaps);
    expect(velo.marketCaps.history).toBeTypeOf("function");
    expect(velo.marketCaps).not.toHaveProperty("query");
  });

  it("is lazy, sends the requested coins, and decodes market caps", async () => {
    const { velo, urls } = client(MARKET_CAPS_CSV);
    const coins = ["BTC", "ETH"];
    const builder = velo.marketCaps.history({ coins });
    const request = builder.build();
    const query = velo.query(builder);

    coins.push("SOL");

    expect(urls).toHaveLength(0);
    expect(request.kind).toBe("marketCaps.history");
    expect(request.params.coins).toEqual(["BTC", "ETH"]);
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.params)).toBe(true);
    expect(Object.isFrozen(request.params.coins)).toBe(true);
    expect(builder.build()).toBe(request);
    expectTypeOf(request).toEqualTypeOf<QueryRequest<"marketCaps.history">>();
    expectTypeOf(query).toEqualTypeOf<Promise<MarketCap[]>>();

    const rows = await query;
    expect(urls).toHaveLength(1);

    const url = new URL(urls[0] as string);
    expect(url.pathname).toBe("/api/v1/caps");
    expect(url.searchParams.get("coins")).toBe("BTC,ETH");
    expect(rows).toEqual([
      {
        coin: "BTC",
        time: 1783513513252,
        circ: 20053612,
        circ_dollars: 1248112746545.6,
        fdv: 20053612,
        fdv_dollars: 1248112746545.6,
      },
      {
        coin: "ETH",
        time: 1783513513252,
        circ: null,
        circ_dollars: null,
        fdv: 120000000,
        fdv_dollars: 300000000000,
      },
    ]);

    const circ: number | null = rows[0]!.circ;
    expect(circ).toBe(20053612);
  });

  it("publishes the response columns in wire order", () => {
    expect(MARKET_CAPS_COLUMNS).toEqual([
      "coin",
      "time",
      "circ",
      "circ_dollars",
      "fdv",
      "fdv_dollars",
    ]);
  });

  it("accepts empty responses", async () => {
    await expect(history(client("").velo, { coins: ["BTC"] })).resolves.toEqual([]);
    await expect(
      history(client("coin,time,circ,circ_dollars,fdv,fdv_dollars\n").velo, { coins: ["BTC"] }),
    ).resolves.toEqual([]);
  });

  it("rejects invalid params before sending a request", () => {
    const { velo, urls } = client("");

    const invalid = [
      { coins: [] },
      { coins: "BTC" },
      { coins: [""] },
      {},
      null,
      { coins: ["BTC"], unexpected: true },
    ];

    for (const params of invalid) {
      expect(() => velo.marketCaps.history(params as never)).toThrow(VeloError);
    }
    expect(() =>
      velo.query({ kind: "marketCaps.history", params: { coins: [] } } as never),
    ).toThrow(VeloError);
    expect(urls).toHaveLength(0);
  });

  it("rejects responses with missing, extra, or reordered columns", async () => {
    const invalid = [
      "coin,time,circ\nBTC,1783513513252,20053612\n",
      "coin,time,circ,circ_dollars,fdv,fdv_dollars,extra\nBTC,1,2,3,4,5,6\n",
      "time,coin,circ,circ_dollars,fdv,fdv_dollars\n1,BTC,2,3,4,5\n",
    ];

    for (const body of invalid) {
      const execution = history(client(body).velo, { coins: ["BTC"] });
      await expect(execution).rejects.toBeInstanceOf(VeloError);
      await expect(execution).rejects.toThrow(/Unexpected \/api\/v1\/caps response/);
    }
  });

  it("rejects invalid response values", async () => {
    const invalid = [
      "coin,time,circ,circ_dollars,fdv,fdv_dollars\n,1,2,3,4,5\n",
      "coin,time,circ,circ_dollars,fdv,fdv_dollars\nBTC,-1,2,3,4,5\n",
      "coin,time,circ,circ_dollars,fdv,fdv_dollars\nBTC,1.5,2,3,4,5\n",
      "coin,time,circ,circ_dollars,fdv,fdv_dollars\nBTC,nope,2,3,4,5\n",
      "coin,time,circ,circ_dollars,fdv,fdv_dollars\nBTC,NaN,2,3,4,5\n",
      "coin,time,circ,circ_dollars,fdv,fdv_dollars\nBTC,1,2,Infinity,4,5\n",
    ];

    for (const body of invalid) {
      await expect(history(client(body).velo, { coins: ["BTC"] })).rejects.toBeInstanceOf(
        VeloError,
      );
    }
  });

  it("decodes market caps through the central query pipeline", async () => {
    const { velo, urls } = client(MARKET_CAPS_CSV);

    const rows = await velo.query(velo.marketCaps.history({ coins: ["BTC", "ETH"] }));

    expect(rows).toHaveLength(2);
    expect(rows[0]?.coin).toBe("BTC");
    expect(urls).toHaveLength(1);
  });
});
