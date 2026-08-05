import { describe, expect, it } from "vitest";

import { VeloError } from "../errors.ts";
import { Velo } from "./client.ts";

function client(): Velo {
  return new Velo({
    apiKey: "test_key",
    fetch: async () => new Response(""),
  });
}

describe("Velo.query", () => {
  it("rejects a malformed request envelope with a VeloError", () => {
    const velo = client();

    expect(() => velo.query(null as never)).toThrow(VeloError);
    expect(() => velo.query(null as never)).toThrow(/query request must be an object/);
    expect(() => velo.query({ kind: 42, params: {} } as never)).toThrow(
      /query request kind must be a string/,
    );
    expect(() => velo.query({ kind: "orderbook.levels" } as never)).toThrow(
      /query request must include params/,
    );
  });

  it("rejects an unknown query kind with a contextual VeloError", () => {
    const velo = client();
    const create = () => velo.query({ kind: "unknown", params: {} } as never);

    expect(create).toThrow(VeloError);
    expect(create).toThrow('Unknown query kind "unknown"');
  });

  it("delegates known request params to the endpoint planner", () => {
    const velo = client();

    expect(() => velo.query({ kind: "orderbook.levels", params: {} } as never)).toThrow(
      /Invalid orderbook params/,
    );
  });
});

describe("Velo.stream", () => {
  const ROWS = "exchange,coin,product,time,close_price\n" + "bybit,BTC,BTCUSDT,1750000000000,1\n";

  function streamingClient(): { velo: Velo; calls: () => number } {
    let calls = 0;
    const velo = new Velo({
      apiKey: "test_key",
      fetch: async () => {
        calls++;
        return new Response(ROWS);
      },
    });
    return { velo, calls: () => calls };
  }

  function request(velo: Velo) {
    return velo.futures
      .price(["close"])
      .for({ coins: ["BTC"] })
      .over({ between: [new Date(0), new Date(60_000)], resolution: "1m" });
  }

  it("yields decoded rows without collecting them into a result", async () => {
    const { velo } = streamingClient();

    const rows = [];
    for await (const row of velo.stream(request(velo))) {
      rows.push(row);
    }

    expect(rows).toEqual([
      { exchange: "bybit", coin: "BTC", product: "BTCUSDT", time: 1750000000000, close_price: 1 },
    ]);
  });

  it("is lazy and sends nothing until the iterator is advanced", async () => {
    const { velo, calls } = streamingClient();

    const stream = velo.stream(request(velo));
    expect(calls()).toBe(0);

    await stream[Symbol.asyncIterator]().next();
    expect(calls()).toBe(1);
  });

  it("accepts only streamable kinds", () => {
    const velo = client();
    const window = { between: [new Date(0), new Date(1)], resolution: "1h" } as const;

    /* Line-oriented endpoints stream; the calls are typed, not executed. */
    void velo.stream(
      velo.futures
        .price(["close"])
        .for({ coins: ["BTC"] })
        .over(window),
    );
    void velo.stream(
      velo.spot
        .price(["close"])
        .for({ coins: ["BTC"] })
        .over(window),
    );
    void velo.stream(
      velo.options
        .iv(["1m"])
        .for({ coins: ["BTC"] })
        .over(window),
    );
    void velo.stream(velo.futures.basis().over(window));
    void velo.stream(velo.orderbook.levels({ coin: "BTC", between: [0, 1], resolution: "1m" }));

    void velo.stream(velo.catalog.futures());
    void velo.stream(velo.catalog.spot());
    void velo.stream(velo.catalog.options());
    void velo.stream(velo.marketCaps.history({ coins: ["BTC"] }));
    void velo.stream(velo.options.terms({ coins: ["BTC"] }));

    // @ts-expect-error news is a JSON document and cannot be decoded line by line
    void velo.stream(velo.news.stories());
  });
});
