import { describe, expect, it } from "vitest";

import { VeloError } from "../../../errors.js";
import { Velo } from "../../client.js";
import { CAPS_COLUMNS } from "./schema.js";

const CAPS_CSV =
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

describe("Velo.caps", () => {
  it("exposes one stable caps endpoint", () => {
    const { velo } = client("");
    expect(velo.caps).toBe(velo.caps);
  });

  it("is lazy, sends the requested coins, and decodes market caps", async () => {
    const { velo, urls } = client(CAPS_CSV);
    const query = velo.caps.query({ coins: ["BTC", "ETH"] });

    expect(urls).toHaveLength(0);

    const rows = await query.execute();
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
    expect(CAPS_COLUMNS).toEqual(["coin", "time", "circ", "circ_dollars", "fdv", "fdv_dollars"]);
  });

  it("accepts empty responses", async () => {
    await expect(
      client("")
        .velo.caps.query({ coins: ["BTC"] })
        .execute(),
    ).resolves.toEqual([]);
    await expect(
      client("coin,time,circ,circ_dollars,fdv,fdv_dollars\n")
        .velo.caps.query({ coins: ["BTC"] })
        .execute(),
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
      expect(() => velo.caps.query(params as never)).toThrow(VeloError);
    }
    expect(urls).toHaveLength(0);
  });

  it("rejects responses with missing, extra, or reordered columns", async () => {
    const invalid = [
      "coin,time,circ\nBTC,1783513513252,20053612\n",
      "coin,time,circ,circ_dollars,fdv,fdv_dollars,extra\nBTC,1,2,3,4,5,6\n",
      "time,coin,circ,circ_dollars,fdv,fdv_dollars\n1,BTC,2,3,4,5\n",
    ];

    for (const body of invalid) {
      const execution = client(body)
        .velo.caps.query({ coins: ["BTC"] })
        .execute();
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
      "coin,time,circ,circ_dollars,fdv,fdv_dollars\nBTC,1,NaN,3,4,5\n",
      "coin,time,circ,circ_dollars,fdv,fdv_dollars\nBTC,1,2,Infinity,4,5\n",
    ];

    for (const body of invalid) {
      await expect(
        client(body)
          .velo.caps.query({ coins: ["BTC"] })
          .execute(),
      ).rejects.toBeInstanceOf(VeloError);
    }
  });
});
