import { describe, expect, it } from "vitest";

import { VeloError } from "../../errors.js";
import { Velo } from "../client.js";

/** A Velo client whose fetch returns `body` and records request URLs. */
function velo(body: string, urls: string[] = []) {
  const fetchFn: typeof globalThis.fetch = async (input) => {
    urls.push(String(input));
    return new Response(body, { status: 200 });
  };
  return { velo: new Velo({ apiKey: "test_key", fetch: fetchFn }), urls };
}

describe("Velo.caps", () => {
  it("queries /api/v1/caps with the coins", async () => {
    const body =
      "coin,time,circ,circ_dollars,fdv,fdv_dollars\nBTC,1783513513252,20053612,1248112746545.6,20053612,1248112746545.6\n";
    const { velo: client, urls } = velo(body);
    const rows = await client.caps({ coins: ["BTC", "SOL"] }).execute();

    const url = new URL(urls[0] as string);
    expect(url.pathname).toBe("/api/v1/caps");
    expect(url.searchParams.get("coins")).toBe("BTC,SOL");
    expect(rows[0]).toMatchObject({ coin: "BTC", circ: 20053612 });
    // fields are typed, no casts needed
    const circDollars: number | null = rows[0]!.circ_dollars;
    expect(circDollars).toBe(1248112746545.6);
  });

  it("rejects an empty coins list at construction, before any request", () => {
    const { velo: client, urls } = velo("");
    expect(() => client.caps({ coins: [] })).toThrow(VeloError);
    expect(() => client.caps({ coins: "BTC" as never })).toThrow(/must be an array/);
    expect(urls).toHaveLength(0);
  });

  it("rejects a response with an unexpected header", async () => {
    const { velo: client } = velo("coin,time,circ\nBTC,1783513513252,20053612\n");
    await expect(client.caps({ coins: ["BTC"] }).execute()).rejects.toThrow(
      /unexpected \/api\/v1\/caps/,
    );
  });
});
