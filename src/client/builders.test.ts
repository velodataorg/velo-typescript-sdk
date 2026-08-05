import { describe, expect, it } from "vitest";

import { catalog, futures, marketCaps, news, options, orderbook, spot, Velo } from "../index.ts";

describe("standalone builders", () => {
  it("describes requests without a client, and a client executes them", async () => {
    const urls: string[] = [];
    const velo = new Velo({
      apiKey: "test_key",
      fetch: async (input) => {
        urls.push(String(input));
        return new Response("exchange,coin,product,time,close_price\n");
      },
    });

    /* No client involved in describing the request. */
    const request = futures
      .price(["close"])
      .for({ exchanges: ["binance-futures"], products: ["BTCUSDT"] })
      .over({ last: "1h", resolution: "1m" });

    await velo.query(request);
    expect(urls[0]).toContain("close_price");
  });

  it("exposes every request-describing namespace", () => {
    expect(futures.price(["close"])).toBeDefined();
    expect(spot.price(["close"])).toBeDefined();
    expect(options.iv(["1m"])).toBeDefined();
    expect(orderbook.levels({ coin: "BTC", last: "1h", resolution: "1m" })).toBeDefined();
    expect(catalog.futures({ coin: "BTC" }).build().kind).toBe("catalog.futures");
    expect(news.stories().build().kind).toBe("news.stories");
    expect(news.feed().build().kind).toBe("news.feed");
    expect(marketCaps.history({ coins: ["BTC"] }).build().kind).toBe("marketCaps.history");
  });

  it("are the same namespaces the client exposes", () => {
    const velo = new Velo({ apiKey: "test_key" });
    expect(velo.futures).toBe(futures);
    expect(velo.news).toBe(news);
    expect(velo.catalog).toBe(catalog);
  });
});
