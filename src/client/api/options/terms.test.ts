import { describe, expect, expectTypeOf, it } from "vitest";

import { VeloError } from "../../../errors.ts";
import { Velo } from "../../client.ts";
import type { Query } from "../../common/query.ts";
import type { QueryRequest } from "../../plan.ts";
import { TERMS_COLUMNS, type TermPoint, type TermsCoin } from "./terms.ts";

const TERMS_CSV =
  "coin,time,at_the_money_iv,dte,fwd_iv\n" +
  "BTC,1767225600000,0.5,7,0.52\n" +
  "ETH,1767830400000,,14,null\n";

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

describe("Velo.options.terms", () => {
  it("is lazy, sends the requested coins, and decodes term points", async () => {
    const { velo, urls } = client(TERMS_CSV);
    const builder = velo.options.terms({ coins: ["BTC", "ETH"] });
    const request = builder.build();
    const query = velo.query(builder);

    expect(urls).toHaveLength(0);
    expect(request.kind).toBe("options.terms");
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.params)).toBe(true);
    expect(Object.isFrozen(request.params.coins)).toBe(true);
    expectTypeOf(request).toEqualTypeOf<QueryRequest<"options.terms">>();
    expectTypeOf(query).toEqualTypeOf<Query<TermPoint, TermPoint[]>>();

    const rows = await query.execute();
    expect(urls).toHaveLength(1);

    const url = new URL(urls[0] as string);
    expect(url.pathname).toBe("/api/v1/terms");
    expect(url.searchParams.get("coins")).toBe("BTC,ETH");
    expect(rows).toEqual([
      {
        coin: "BTC",
        time: 1767225600000,
        at_the_money_iv: 0.5,
        dte: 7,
        fwd_iv: 0.52,
      },
      {
        coin: "ETH",
        time: 1767830400000,
        at_the_money_iv: null,
        dte: 14,
        fwd_iv: null,
      },
    ]);

    const coin: TermsCoin = rows[0]!.coin;
    const forwardIv: number | null = rows[0]!.fwd_iv;
    expect(coin).toBe("BTC");
    expect(forwardIv).toBe(0.52);
  });

  it("publishes the response columns in wire order", () => {
    expect(TERMS_COLUMNS).toEqual(["coin", "time", "at_the_money_iv", "dte", "fwd_iv"]);
  });

  it("accepts empty responses", async () => {
    await expect(
      client("")
        .velo.options.terms({ coins: ["BTC"] })
        .fetch(),
    ).resolves.toEqual([]);
    await expect(
      client("coin,time,at_the_money_iv,dte,fwd_iv\n")
        .velo.options.terms({ coins: ["BTC"] })
        .fetch(),
    ).resolves.toEqual([]);
  });

  it("rejects invalid params before sending a request", () => {
    const { velo, urls } = client("");
    const invalid = [
      { coins: [] },
      { coins: ["SOL"] },
      { coins: ["btc"] },
      { coins: [""] },
      { coins: "BTC" },
      {},
      null,
      { coins: ["BTC"], unexpected: true },
    ];

    for (const params of invalid) {
      expect(() => velo.options.terms(params as never)).toThrow(VeloError);
    }
    expect(urls).toHaveLength(0);
  });

  it("rejects responses with missing, extra, or reordered columns", async () => {
    const invalid = [
      "coin,time,at_the_money_iv\nBTC,1767225600000,0.5\n",
      "coin,time,at_the_money_iv,dte,fwd_iv,extra\nBTC,1,2,3,4,5\n",
      "time,coin,at_the_money_iv,dte,fwd_iv\n1,BTC,2,3,4\n",
    ];

    for (const body of invalid) {
      const execution = client(body)
        .velo.options.terms({ coins: ["BTC"] })
        .fetch();
      await expect(execution).rejects.toBeInstanceOf(VeloError);
      await expect(execution).rejects.toThrow(/Unexpected \/api\/v1\/terms response/);
    }
  });

  it("keeps every row when cells use the NaN or undefined missing-value markers", async () => {
    const body =
      "coin,time,at_the_money_iv,dte,fwd_iv\n" +
      "BTC,1767225600000,0.5,7,0.52\n" +
      "BTC,1767229200000,NaN,7,0.53\n" +
      "ETH,1767830400000,0.6,undefined,0.61\n";

    await expect(
      client(body)
        .velo.options.terms({ coins: ["BTC", "ETH"] })
        .fetch(),
    ).resolves.toEqual([
      { coin: "BTC", time: 1767225600000, at_the_money_iv: 0.5, dte: 7, fwd_iv: 0.52 },
      { coin: "BTC", time: 1767229200000, at_the_money_iv: null, dte: 7, fwd_iv: 0.53 },
      { coin: "ETH", time: 1767830400000, at_the_money_iv: 0.6, dte: null, fwd_iv: 0.61 },
    ]);
  });

  it("rejects invalid response values", async () => {
    const invalid = [
      "coin,time,at_the_money_iv,dte,fwd_iv\nSOL,1,2,3,4\n",
      "coin,time,at_the_money_iv,dte,fwd_iv\nBTC,-1,2,3,4\n",
      "coin,time,at_the_money_iv,dte,fwd_iv\nBTC,1.5,2,3,4\n",
      "coin,time,at_the_money_iv,dte,fwd_iv\nBTC,nope,2,3,4\n",
      "coin,time,at_the_money_iv,dte,fwd_iv\nBTC,NaN,2,3,4\n",
      "coin,time,at_the_money_iv,dte,fwd_iv\nBTC,1,2,Infinity,4\n",
      "coin,time,at_the_money_iv,dte,fwd_iv\nBTC,1,2,3,nope\n",
    ];

    for (const body of invalid) {
      await expect(
        client(body)
          .velo.options.terms({ coins: ["BTC"] })
          .fetch(),
      ).rejects.toBeInstanceOf(VeloError);
    }
  });

  it("streams term points through the central query pipeline", async () => {
    const { velo, urls } = client(TERMS_CSV);
    const rows: TermPoint[] = [];

    for await (const row of velo.options.terms({ coins: ["BTC", "ETH"] }).stream()) {
      rows.push(row);
    }

    expect(rows).toHaveLength(2);
    expect(rows[0]?.coin).toBe("BTC");
    expect(urls).toHaveLength(1);
  });
});
