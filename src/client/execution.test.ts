import { describe, expect, it } from "vitest";

import { VeloError } from "../errors.ts";
import { futures, Velo } from "../index.ts";
import { MAX_IN_FLIGHT_REQUESTS } from "./common/query.ts";

/**
 * How the client executes a request, observed where a caller observes it.
 *
 * Chunking, prefetch, ordering and cancellation are properties of
 * `velo.query()` and `velo.stream()`, not of any one internal class, so they
 * are asserted through those two entry points against a fake transport.
 */

const MINUTE = 60_000;

/* Wide enough that the planner splits the window into two requests. */
const TWO_REQUESTS = 22_501;
/* Wide enough to exceed the in-flight cap. */
const FIVE_REQUESTS = 90_000;

function rangeOf(minutes: number) {
  const end = Date.now();
  return { between: [end - minutes * MINUTE, end] as [number, number], resolution: "1m" as const };
}

function request(minutes: number) {
  return futures
    .price(["close"])
    .for({ exchanges: ["binance-futures"], products: ["BTCUSDT"] })
    .over(rangeOf(minutes));
}

/** The `begin` of a chunk, which identifies it and orders it. */
function beginOf(input: string | URL | Request): number {
  return Number(new URL(String(input)).searchParams.get("begin"));
}

/** One CSV row stamped with the chunk's own begin. */
function chunk(input: string | URL | Request): Response {
  const begin = beginOf(input);
  return new Response(
    `exchange,coin,product,time,close_price\nbinance-futures,BTC,BTCUSDT,${begin},1\n`,
  );
}

function client(fetch: typeof globalThis.fetch): Velo {
  return new Velo({ apiKey: "test_key", fetch, retry: { retries: 0 } });
}

describe("velo.query", () => {
  it("collects rows from every chunk in request order", async () => {
    const begins: number[] = [];
    const velo = client(async (input) => {
      begins.push(beginOf(input));
      return chunk(input);
    });

    const data = await velo.query(request(TWO_REQUESTS));
    const rows = data.rows();

    expect(begins).toHaveLength(2);
    expect(rows.map((row) => row.time)).toEqual(begins);
    expect(begins[0]).toBeLessThan(begins[1] as number);
  });

  it("rejects before sending when a transport option is invalid", async () => {
    let calls = 0;
    const velo = client(async (input) => {
      calls++;
      return chunk(input);
    });

    await expect(velo.query(request(100), { timeout: 0 })).rejects.toBeInstanceOf(VeloError);
    expect(calls).toBe(0);
  });

  it("surfaces a decoder failure", async () => {
    const velo = client(async () => new Response("not,a,known,header\n1,2,3,4\n"));

    await expect(velo.query(request(100))).rejects.toBeInstanceOf(VeloError);
  });
});

describe("velo.stream", () => {
  it("sends nothing until iteration starts, then prefetches ahead", async () => {
    let calls = 0;
    const velo = client(async (input) => {
      calls++;
      return chunk(input);
    });

    const rows = velo.stream(request(TWO_REQUESTS));
    expect(calls).toBe(0);

    await rows.next();
    expect(calls).toBe(2);

    await rows.return(undefined);
  });

  it("yields rows in request order when responses complete out of order", async () => {
    let calls = 0;
    const velo = client(async (input) => {
      /* The first chunk requested is the last to resolve. */
      const delay = ++calls === 1 ? 20 : 0;
      await new Promise((resolve) => setTimeout(resolve, delay));
      return chunk(input);
    });

    const times: number[] = [];
    for await (const row of velo.stream(request(TWO_REQUESTS))) times.push(row.time);

    expect(times).toHaveLength(2);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("keeps at most MAX_IN_FLIGHT_REQUESTS requests in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    const release: (() => void)[] = [];
    const velo = client(async (input) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise<void>((resolve) => release.push(resolve));
      inFlight--;
      return chunk(input);
    });

    const rows = velo.stream(request(FIVE_REQUESTS));
    const pending = rows.next();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(peak).toBe(MAX_IN_FLIGHT_REQUESTS);

    for (const resolve of release) resolve();
    await pending;
    await rows.return(undefined);
  });

  it("aborts the in-flight prefetch when iteration ends early", async () => {
    const signals: AbortSignal[] = [];
    const velo = client(async (input, init) => {
      const signal = init?.signal as AbortSignal;
      signals.push(signal);
      if (signals.length === 1) return chunk(input);
      return new Promise<Response>((_, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), {
          once: true,
        });
      });
    });

    for await (const _row of velo.stream(request(TWO_REQUESTS))) break;

    expect(signals).toHaveLength(2);
    expect(signals[1]?.aborted).toBe(true);
  });

  it("aborts in-flight requests when the caller's signal aborts", async () => {
    const controller = new AbortController();
    const signals: AbortSignal[] = [];
    const velo = client(async (input, init) => {
      const signal = init?.signal as AbortSignal;
      signals.push(signal);
      if (signals.length === 1) return chunk(input);
      return new Promise<Response>((_, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), {
          once: true,
        });
      });
    });

    const rows = velo.stream(request(TWO_REQUESTS), { signal: controller.signal });
    await rows.next();
    controller.abort();

    await expect(rows.next()).rejects.toThrow();
    expect(signals[1]?.aborted).toBe(true);
  });

  it("yields earlier rows before surfacing a later chunk's failure", async () => {
    let calls = 0;
    const velo = client(async (input) => {
      calls++;
      if (calls === 1) return chunk(input);
      return new Response("server exploded", { status: 500 });
    });

    const seen: number[] = [];
    await expect(
      (async () => {
        for await (const row of velo.stream(request(TWO_REQUESTS))) seen.push(row.time);
      })(),
    ).rejects.toBeInstanceOf(VeloError);

    expect(seen).toHaveLength(1);
  });
});
