import { describe, expect, it } from "vitest";

import { VeloError } from "../../../errors.js";
import { Velo } from "../../client.js";

function client(body: string, urls: string[] = []) {
  const fetch: typeof globalThis.fetch = async (input) => {
    urls.push(String(input));
    return new Response(body);
  };
  return { velo: new Velo({ apiKey: "test_key", fetch }), urls };
}

describe("Velo.spot", () => {
  const params = {
    exchanges: ["coinbase", "binance"],
    coins: ["BTC"],
    columns: ["close_price", "coin_volume"],
    begin: Date.UTC(2026, 0, 1),
    end: Date.UTC(2026, 0, 1, 1),
    resolution: "1m",
  } as const;

  it("uses the spot market and returns spot-typed rows", async () => {
    const body =
      "exchange,coin,product,time,close_price,coin_volume\n" +
      "coinbase,BTC,BTC-USD,1767225600000,100000,12.5\n";
    const { velo, urls } = client(body);
    expect(velo.spot).toBe(velo.spot);

    const rows = (await velo.spot.query(params).execute()).rows();
    expect(new URL(urls[0] as string).searchParams.get("type")).toBe("spot");

    const exchange: "binance" | "bybit-spot" | "coinbase" | "okex" = rows[0]!.exchange;
    const volume: number | null = rows[0]!.coin_volume;
    expect(exchange).toBe("coinbase");
    expect(volume).toBe(12.5);
  });

  it("rejects futures columns and exchanges at runtime", () => {
    const { velo } = client("");
    expect(() => velo.spot.query({ ...params, columns: ["funding_rate"] } as never)).toThrow(
      VeloError,
    );
    expect(() => velo.spot.query({ ...params, exchanges: ["binance-futures"] } as never)).toThrow(
      VeloError,
    );
  });
});
