import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { VeloError, VeloHttpError } from "../../../errors.ts";
import { Velo } from "../../client.ts";
import type { QueryRequest } from "../../query/plan.ts";
import type { OrderbookLevelsBuilder } from "./builder.ts";
import type { OrderbookData } from "./data.ts";
import type { OrderbookScope } from "./scope.ts";

const HOUR = 3_600_000;
const MINUTE = 60_000;

/* Aligned to whole hours and safely in the past for the default system time. */
const SCOPE: OrderbookScope = {
  exchange: "binance-futures",
  product: "BTCUSDT",
  between: [HOUR, 3 * HOUR],
  resolution: "1h",
};

const BODY = `15\n${HOUR},100,95,1,105,2\n${2 * HOUR},101,96,3\n`;

function client(bodies: readonly string[]) {
  const urls: string[] = [];
  const fetch: typeof globalThis.fetch = async (input) => {
    urls.push(String(input));
    const body = bodies[urls.length - 1];
    if (body === undefined) throw new Error(`Unexpected request ${urls.length}: ${String(input)}`);
    return new Response(body);
  };

  return {
    velo: new Velo({ apiKey: "test_key", fetch }),
    urls,
  };
}

function orderbookQuery(velo: Velo, scope: OrderbookScope) {
  return velo.query(velo.orderbook.levels(scope));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Velo.orderbook", () => {
  it("exposes one stable orderbook endpoint", () => {
    const { velo } = client([""]);
    expect(velo.orderbook).toBe(velo.orderbook);
  });

  it("is lazy and sends the product target on the wire", async () => {
    const { velo, urls } = client([BODY]);
    const builder = velo.orderbook.levels(SCOPE);
    const request = builder.build();

    expect(request).toEqual({
      kind: "orderbook.levels",
      params: {
        exchange: "binance-futures",
        product: "BTCUSDT",
        begin: HOUR,
        end: 3 * HOUR,
        resolution: "1h",
      },
    });
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.params)).toBe(true);
    expect(urls).toHaveLength(0);
    expect(builder.build()).toBe(request);
    expectTypeOf(builder).toEqualTypeOf<OrderbookLevelsBuilder>();
    expectTypeOf(request).toEqualTypeOf<QueryRequest<"orderbook.levels">>();

    const query = velo.query(builder);
    expectTypeOf(query).toEqualTypeOf<Promise<OrderbookData>>();

    await query;
    expect(urls).toHaveLength(1);

    const url = new URL(urls[0] as string);
    expect(url.pathname).toBe("/api/l/levels");
    expect(url.searchParams.get("exchange")).toBe("binance-futures");
    expect(url.searchParams.get("product")).toBe("BTCUSDT");
    expect(url.searchParams.get("coin")).toBeNull();
    expect(url.searchParams.get("begin")).toBe(String(HOUR));
    expect(url.searchParams.get("end")).toBe(String(3 * HOUR));
    expect(url.searchParams.get("reso")).toBe("60");
    expect(url.searchParams.get("forward")).toBe("1");
  });

  it("sends a coin target without product parameters", async () => {
    const { velo, urls } = client([BODY]);
    await velo.query(
      velo.orderbook.levels({
        coin: "BTC",
        between: [HOUR, 3 * HOUR],
        resolution: "1h",
      }),
    );

    const url = new URL(urls[0] as string);
    expect(url.searchParams.get("coin")).toBe("BTC");
    expect(url.searchParams.get("exchange")).toBeNull();
    expect(url.searchParams.get("product")).toBeNull();
  });

  it("decodes the response into OrderbookData", async () => {
    const { velo } = client([BODY]);
    const data = await orderbookQuery(velo, SCOPE);

    expect(data.rows()).toEqual([
      {
        time: HOUR,
        mid: 100,
        step: 15,
        prices: Float64Array.from([95, 105]),
        sizes: Float64Array.from([1, 2]),
      },
      {
        time: 2 * HOUR,
        mid: 101,
        step: 15,
        prices: Float64Array.from([96]),
        sizes: Float64Array.from([3]),
      },
    ]);
    expect(data.snapshots()[0]).toEqual({
      time: HOUR,
      mid: 100,
      bids: [{ price: 95, size: 1 }],
      asks: [{ price: 105, size: 2 }],
    });
  });

  it("widens an unaligned range to complete buckets", async () => {
    const { velo, urls } = client([BODY]);
    await orderbookQuery(velo, {
      ...SCOPE,
      between: [HOUR + MINUTE, 3 * HOUR - MINUTE],
    });

    const url = new URL(urls[0] as string);
    expect(url.searchParams.get("begin")).toBe(String(HOUR));
    expect(url.searchParams.get("end")).toBe(String(3 * HOUR));
  });

  it("caps an end in the future at the current time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(2 * HOUR + 30 * MINUTE);

    const { velo, urls } = client([BODY]);
    await orderbookQuery(velo, { ...SCOPE, between: [HOUR, 10 * HOUR] });

    const url = new URL(urls[0] as string);
    expect(url.searchParams.get("end")).toBe(String(2 * HOUR + 30 * MINUTE));
  });

  it("anchors a trailing duration when the terminal method runs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(3 * HOUR);

    const { velo, urls } = client([BODY]);
    await orderbookQuery(velo, {
      exchange: "binance-futures",
      product: "BTCUSDT",
      last: "2h",
      resolution: "1h",
    });

    const url = new URL(urls[0] as string);
    expect(url.searchParams.get("begin")).toBe(String(HOUR));
    expect(url.searchParams.get("end")).toBe(String(3 * HOUR));
  });

  it("splits a range past the bucket cap into contiguous requests", async () => {
    const capMs = 512 * MINUTE;
    const bodies = [`15\n0,100,95,1\n`, `20\n${capMs},101,96,2\n`];
    const { velo, urls } = client(bodies);

    const data = await orderbookQuery(velo, {
      ...SCOPE,
      between: [0, capMs + MINUTE],
      resolution: "1m",
    });

    expect(urls).toHaveLength(2);
    const first = new URL(urls[0] as string);
    const second = new URL(urls[1] as string);
    expect(first.searchParams.get("begin")).toBe("0");
    expect(first.searchParams.get("end")).toBe(String(capMs));
    expect(second.searchParams.get("begin")).toBe(String(capMs));
    expect(second.searchParams.get("end")).toBe(String(capMs + MINUTE));

    /* Each chunk keeps its own grid step. */
    expect(data.rows().map((row) => row.step)).toEqual([15, 20]);
  });

  it("streams rows in order through the namespace", async () => {
    const { velo } = client([BODY]);

    const times: number[] = [];
    for await (const row of velo.stream(velo.orderbook.levels(SCOPE))) {
      times.push(row.time);
    }

    expect(times).toEqual([HOUR, 2 * HOUR]);
  });

  it("forwards query-level transport options", async () => {
    const { velo, urls } = client([BODY]);

    await expect(velo.query(velo.orderbook.levels(SCOPE), { timeout: 0 })).rejects.toBeInstanceOf(
      VeloError,
    );
    expect(urls).toHaveLength(0);
  });

  it("lowers a weekly resolution to Monday-aligned minute buckets", async () => {
    const { velo, urls } = client([BODY]);
    await orderbookQuery(velo, {
      ...SCOPE,
      between: [Date.UTC(2026, 0, 7), Date.UTC(2026, 0, 13)],
      resolution: "1W",
    });

    const url = new URL(urls[0] as string);
    expect(url.searchParams.get("reso")).toBe("10080");
    expect(url.searchParams.get("begin")).toBe(String(Date.UTC(2026, 0, 5)));
    expect(url.searchParams.get("end")).toBe(String(Date.UTC(2026, 0, 19)));
  });

  it("converts Date bounds to millisecond timestamps", async () => {
    const { velo, urls } = client([BODY]);
    await orderbookQuery(velo, {
      ...SCOPE,
      between: [new Date(HOUR), new Date(3 * HOUR)],
    });

    const url = new URL(urls[0] as string);
    expect(url.searchParams.get("begin")).toBe(String(HOUR));
    expect(url.searchParams.get("end")).toBe(String(3 * HOUR));
  });

  it("surfaces HTTP failures as typed errors", async () => {
    const fetch: typeof globalThis.fetch = async () =>
      new Response("product binance-futures NOPEUSDT undefined not found", { status: 404 });
    const velo = new Velo({ apiKey: "test_key", fetch });

    await expect(orderbookQuery(velo, SCOPE)).rejects.toBeInstanceOf(VeloHttpError);
    await expect(orderbookQuery(velo, SCOPE)).rejects.toThrow(/not found/);
  });

  it("rejects empty target strings", () => {
    const { velo } = client([BODY]);

    expect(() => orderbookQuery(velo, { ...SCOPE, product: "" })).toThrow(
      /Invalid orderbook params/,
    );
    expect(() =>
      orderbookQuery(velo, { coin: "", between: [HOUR, 3 * HOUR], resolution: "1h" }),
    ).toThrow(/Invalid orderbook params/);
  });

  it("wraps a malformed response with endpoint context", async () => {
    const { velo } = client(["not a levels response\n"]);

    await expect(orderbookQuery(velo, SCOPE)).rejects.toThrow(
      /Unexpected \/api\/l\/levels response/,
    );
  });

  it("rejects a scope that selects both or neither target", () => {
    const { velo } = client([BODY]);

    expect(() => orderbookQuery(velo, { ...SCOPE, coin: "BTC" } as never)).toThrow(
      /cannot select both a product and a coin/,
    );
    expect(() =>
      orderbookQuery(velo, { between: [HOUR, 3 * HOUR], resolution: "1h" } as never),
    ).toThrow(/must select an exchange and product, or a coin/);
  });

  it("rejects scopes the types rule out", () => {
    const { velo } = client([BODY]);

    expect(() => orderbookQuery(velo, { ...SCOPE, resolution: "1M" } as never)).toThrow(VeloError);
    expect(() => orderbookQuery(velo, { ...SCOPE, resolution: undefined } as never)).toThrow(
      /must set a resolution/,
    );
    expect(() => orderbookQuery(velo, { ...SCOPE, exchange: "nasdaq" } as never)).toThrow(
      /Invalid orderbook params/,
    );
    expect(() => orderbookQuery(velo, { ...SCOPE, between: [3 * HOUR, HOUR] } as never)).toThrow(
      VeloError,
    );
  });

  it("yields buckets while the response is still arriving", async () => {
    let releaseTail: () => void;
    const tail = new Promise<void>((resolve) => {
      releaseTail = resolve;
    });
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode(`15\n${HOUR},100,95,1\n`));
        await tail;
        controller.enqueue(encoder.encode(`${2 * HOUR},101,96,2\n`));
        controller.close();
      },
    });
    const velo = new Velo({ apiKey: "test_key", fetch: async () => new Response(body) });

    const rows = velo.stream(velo.orderbook.levels(SCOPE))[Symbol.asyncIterator]();
    await expect(rows.next().then((r) => r.value?.time)).resolves.toBe(HOUR);

    releaseTail!();
    await expect(rows.next().then((r) => r.value?.time)).resolves.toBe(2 * HOUR);
  });
});
