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

describe("Velo.options.terms", () => {
  it("queries /api/v1/terms with the coins", async () => {
    const body = "coin,time,at_the_money_iv,dte,fwd_iv\nBTC,1767225600000,0.5,7,0.52\n";
    const { velo: client, urls } = velo(body);
    const rows = await client.options.terms({ coins: ["BTC"] }).execute();

    const url = new URL(urls[0] as string);
    expect(url.pathname).toBe("/api/v1/terms");
    expect(url.searchParams.get("coins")).toBe("BTC");
    expect(rows[0]).toMatchObject({ coin: "BTC", at_the_money_iv: 0.5 });
    // fields are typed, no casts needed
    const fwdIv: number | null = rows[0]!.fwd_iv;
    expect(fwdIv).toBe(0.52);
  });

  it("rejects a response with an unexpected header", async () => {
    const { velo: client } = velo("coin,time,at_the_money_iv\nBTC,1767225600000,0.5\n");
    await expect(client.options.terms({ coins: ["BTC"] }).execute()).rejects.toThrow(
      /unexpected \/api\/v1\/terms/,
    );
  });

  it("rejects coins other than BTC and ETH at construction, before any request", () => {
    const { velo: client, urls } = velo("");
    expect(() => client.options.terms({ coins: ["SOL" as never] })).toThrow(/BTC, ETH/);
    expect(() => client.options.terms({ coins: [] })).toThrow(VeloError);
    expect(urls).toHaveLength(0);
  });
});
