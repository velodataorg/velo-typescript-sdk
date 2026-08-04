import { describe, expect, it } from "vitest";

import { VeloError } from "../../../errors.ts";
import { Velo } from "../../client.ts";

function client(body: string, urls: string[] = []) {
  const fetch: typeof globalThis.fetch = async (input) => {
    urls.push(String(input));
    return new Response(body);
  };
  return { velo: new Velo({ apiKey: "test_key", fetch }), urls };
}

describe("Velo.options", () => {
  const params = {
    exchanges: ["deribit"],
    coins: ["BTC"],
    columns: ["iv_1m", "dvol_close", "index_price"],
    begin: Date.UTC(2026, 0, 1),
    end: Date.UTC(2026, 0, 1, 1),
    resolution: "1m",
  } as const;

  it("uses the options market and returns options-typed rows", async () => {
    const body =
      "exchange,coin,product,time,iv_1m,dvol_close,index_price\n" +
      "deribit,BTC,BTC,1767225600000,0.55,52.4,100000\n";
    const { velo, urls } = client(body);
    expect(velo.options).toBe(velo.options);
    expect(velo.options).not.toHaveProperty("query");

    const rows = (await velo.query({ kind: "options.rows", params }).execute()).rows();
    expect(new URL(urls[0] as string).searchParams.get("type")).toBe("options");

    const exchange: "deribit" = rows[0]!.exchange;
    const impliedVolatility: number | null = rows[0]!.iv_1m;
    expect(exchange).toBe("deribit");
    expect(impliedVolatility).toBe(0.55);
  });

  it("rejects spot columns and exchanges at runtime", () => {
    const { velo } = client("");
    expect(() =>
      velo.query({
        kind: "options.rows",
        params: { ...params, columns: ["close_price"] },
      } as never),
    ).toThrow(VeloError);
    expect(() =>
      velo.query({
        kind: "options.rows",
        params: { ...params, exchanges: ["coinbase"] },
      } as never),
    ).toThrow(VeloError);
  });
});
