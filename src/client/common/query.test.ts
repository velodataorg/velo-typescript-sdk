import { describe, expect, it } from "vitest";

import { VeloError } from "../../errors.ts";
import { Http } from "../../transport/http.ts";
import type { HttpParams } from "../../transport/http.ts";
import { MAX_IN_FLIGHT_REQUESTS, MAX_REQUESTS_PER_QUERY, Query } from "./query.ts";
import type { HttpRequest, QueryOptions } from "./query.ts";

interface Point {
  step: number;
  value: number;
}

const OPTIONS: QueryOptions<Point> = {
  requests: [
    { path: "/api/v1/test", params: { step: 1 } },
    { path: "/api/v1/test", params: { step: 2 } },
  ],
  decode: decodePoints,
};

function decodePoints(body: string): Point[] {
  return JSON.parse(body) as Point[];
}

function response(step: number): Response {
  return new Response(JSON.stringify([{ step, value: step * 10 }]));
}

function http(fetch: typeof globalThis.fetch): Http {
  return new Http({
    apiKey: "test_key",
    fetch,
    retry: { retries: 0 },
  });
}

function stepFrom(input: string | URL | Request): number {
  return Number(new URL(String(input)).searchParams.get("step"));
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) {
    items.push(item);
  }
  return items;
}

describe("Query.execute", () => {
  it("executes every request and collects decoded items in request order", async () => {
    const urls: string[] = [];
    const fetch: typeof globalThis.fetch = async (input) => {
      urls.push(String(input));
      return response(stepFrom(input));
    };

    const points = await new Query(http(fetch), OPTIONS).execute();

    expect(points).toEqual([
      { step: 1, value: 10 },
      { step: 2, value: 20 },
    ]);
    expect(urls).toEqual([
      "https://api.velo.xyz/api/v1/test?step=1",
      "https://api.velo.xyz/api/v1/test?step=2",
    ]);
  });

  it("completes without sending anything when there are no requests", async () => {
    let calls = 0;
    const fetch: typeof globalThis.fetch = async () => {
      calls++;
      return response(1);
    };
    const options: QueryOptions<Point> = {
      requests: [],
      decode: decodePoints,
    };

    await expect(new Query(http(fetch), options).execute()).resolves.toEqual([]);
    expect(calls).toBe(0);
  });

  it("forwards query-level transport options", async () => {
    let calls = 0;
    const fetch: typeof globalThis.fetch = async () => {
      calls++;
      return response(1);
    };

    await expect(new Query(http(fetch), OPTIONS, { timeout: 0 }).execute()).rejects.toBeInstanceOf(
      VeloError,
    );
    expect(calls).toBe(0);
  });

  it("shapes the result with collect and keeps it in the snapshot", async () => {
    const fetch: typeof globalThis.fetch = async (input) => response(stepFrom(input));
    const options: QueryOptions<Point, number> = {
      ...OPTIONS,
      collect: (points) => points.reduce((sum, point) => sum + point.value, 0),
    };
    const query = new Query(http(fetch), options);

    expect(query.options.collect).toBe(options.collect);
    await expect(query.execute()).resolves.toBe(30);
  });

  it("is lazy and memoizes its collected promise", async () => {
    let calls = 0;
    const fetch: typeof globalThis.fetch = async (input) => {
      calls++;
      return response(stepFrom(input));
    };
    const query = new Query(http(fetch), OPTIONS);

    expect(calls).toBe(0);
    const first = query.execute();
    const second = query.execute();
    await expect(Promise.all([first, second])).resolves.toEqual([
      [
        { step: 1, value: 10 },
        { step: 2, value: 20 },
      ],
      [
        { step: 1, value: 10 },
        { step: 2, value: 20 },
      ],
    ]);
    expect(calls).toBe(2);
  });

  it("assimilates when returned by an async function", async () => {
    const fetch: typeof globalThis.fetch = async (input) => response(stepFrom(input));
    const create = async () => new Query(http(fetch), OPTIONS).execute();

    await expect(create()).resolves.toEqual([
      { step: 1, value: 10 },
      { step: 2, value: 20 },
    ]);
  });
});

describe("Query options", () => {
  it("rejects more than the maximum number of requests before snapshotting", () => {
    const requests = Array.from({ length: MAX_REQUESTS_PER_QUERY + 1 }, (_, index) => ({
      path: "/api/v1/test",
      params: { step: index },
    }));

    expect(
      () =>
        new Query(
          http(async () => response(1)),
          {
            requests,
            decode: decodePoints,
          },
        ),
    ).toThrow(
      `Query has ${MAX_REQUESTS_PER_QUERY + 1} HTTP requests, exceeding the limit of ` +
        `${MAX_REQUESTS_PER_QUERY}`,
    );
  });

  it("snapshots and freezes request params without freezing caller-owned data", () => {
    const products = ["BTCUSDT"];
    const params: HttpParams = { step: 1, products };
    const request: HttpRequest = { path: "/api/v1/test", params };
    const options: QueryOptions<Point> = {
      requests: [request],
      decode: decodePoints,
    };

    const query = new Query(
      http(async () => response(1)),
      options,
    );
    products.push("ETHUSDT");
    params.step = 2;
    const captured = query.options.requests[0]!;

    expect(query.options).not.toBe(options);
    expect(captured.params).toEqual({
      step: 1,
      products: ["BTCUSDT"],
    });
    expect(Object.isFrozen(query.options)).toBe(true);
    expect(Object.isFrozen(query.options.requests)).toBe(true);
    expect(Object.isFrozen(captured.params)).toBe(true);
    expect(Object.isFrozen(captured.params.products)).toBe(true);
    expect(Object.isFrozen(products)).toBe(false);
    expect(() => (captured.params.products as string[]).push("SOLUSDT")).toThrow(TypeError);
  });
});

describe("Query.stream", () => {
  it("is lazy and prefetches the next request in order", async () => {
    const urls: string[] = [];
    const fetch: typeof globalThis.fetch = async (input) => {
      urls.push(String(input));
      return response(stepFrom(input));
    };

    const stream = new Query(http(fetch), OPTIONS).stream();
    expect(urls).toHaveLength(0);

    const first = await stream.next();
    expect(first.value).toEqual({ step: 1, value: 10 });
    expect(urls).toHaveLength(2);

    await expect(collect(stream)).resolves.toEqual([{ step: 2, value: 20 }]);
  });

  it("aborts an in-flight prefetch when iteration ends early", async () => {
    const signals: AbortSignal[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const signal = init?.signal as AbortSignal;
      signals.push(signal);

      if (stepFrom(input) === 1) return response(1);
      return new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), {
          once: true,
        });
      });
    };

    for await (const point of new Query(http(fetch), OPTIONS).stream()) {
      expect(point.step).toBe(1);
      break;
    }

    expect(signals).toHaveLength(2);
    expect(signals[1]?.aborted).toBe(true);
  });

  it("aborts in-flight requests when the caller's signal aborts mid-stream", async () => {
    const signals: AbortSignal[] = [];
    const controller = new AbortController();
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const signal = init?.signal as AbortSignal;
      signals.push(signal);

      if (stepFrom(input) === 1) return response(1);
      return new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    };

    const stream = new Query(http(fetch), OPTIONS).stream({ signal: controller.signal });
    await expect(stream.next()).resolves.toMatchObject({
      value: { step: 1, value: 10 },
      done: false,
    });

    controller.abort();
    const error = await stream.next().catch((e: unknown) => e);
    expect((error as Error).name).toBe("AbortError");
    expect(signals[1]?.aborted).toBe(true);
  });

  it("merges streaming overrides with query-level transport options", async () => {
    const fetch: typeof globalThis.fetch = async (input) => response(stepFrom(input));
    const query = new Query(http(fetch), OPTIONS, { timeout: 0 });

    await expect(collect(query.stream({ timeout: 1_000 }))).resolves.toHaveLength(2);
  });

  it("surfaces a prefetched failure after yielding earlier items", async () => {
    const fetch: typeof globalThis.fetch = async (input) => {
      if (stepFrom(input) === 1) return response(1);
      return new Response("bad request", { status: 400 });
    };
    const stream = new Query(http(fetch), OPTIONS).stream();

    await expect(stream.next()).resolves.toMatchObject({
      value: { step: 1, value: 10 },
      done: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(stream.next()).rejects.toBeInstanceOf(VeloError);
  });

  it("keeps at most MAX_IN_FLIGHT_REQUESTS requests in flight", async () => {
    const resolvers = new Map<number, (response: Response) => void>();
    const started: number[] = [];
    let deferring = true;
    const fetch: typeof globalThis.fetch = (input) => {
      const step = stepFrom(input);
      started.push(step);
      if (!deferring) return Promise.resolve(response(step));
      return new Promise((resolve) => resolvers.set(step, resolve));
    };
    const requests = Array.from({ length: MAX_IN_FLIGHT_REQUESTS + 2 }, (_, index) => ({
      path: "/api/v1/test",
      params: { step: index + 1 },
    }));
    const stream = new Query(http(fetch), { requests, decode: decodePoints }).stream();

    const first = stream.next();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toHaveLength(MAX_IN_FLIGHT_REQUESTS);

    deferring = false;
    resolvers.get(1)!(response(1));
    await expect(first).resolves.toMatchObject({ value: { step: 1, value: 10 } });
    expect(started).toHaveLength(MAX_IN_FLIGHT_REQUESTS + 1);

    for (const [step, resolve] of resolvers) {
      if (step > 1) resolve(response(step));
    }
    const rest = await collect(stream);
    expect(rest.map((point) => point.step)).toEqual([2, 3, 4, 5, 6]);
    expect(started).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("yields rows in request order when responses complete out of order", async () => {
    const resolvers = new Map<number, (response: Response) => void>();
    const fetch: typeof globalThis.fetch = (input) =>
      new Promise((resolve) => resolvers.set(stepFrom(input), resolve));
    const requests = [1, 2, 3].map((step) => ({ path: "/api/v1/test", params: { step } }));

    const points = collect(new Query(http(fetch), { requests, decode: decodePoints }).stream());
    await new Promise((resolve) => setTimeout(resolve, 0));

    resolvers.get(3)!(response(3));
    resolvers.get(1)!(response(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    resolvers.get(2)!(response(2));

    await expect(points).resolves.toEqual([
      { step: 1, value: 10 },
      { step: 2, value: 20 },
      { step: 3, value: 30 },
    ]);
  });

  it("propagates decoder failures", async () => {
    const options: QueryOptions<Point> = {
      requests: [{ path: "/api/v1/test", params: { step: 1 } }],
      decode: decodePoints,
    };
    const query = new Query(
      http(async () => new Response("not JSON")),
      options,
    );

    await expect(query.execute()).rejects.toBeInstanceOf(SyntaxError);
  });
});
