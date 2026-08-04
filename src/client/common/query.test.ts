import { describe, expect, it } from "vitest";

import { Http } from "../../transport/http.ts";
import type { HttpParams } from "../../transport/http.ts";
import { MAX_REQUESTS_PER_QUERY, Query } from "./query.ts";
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

async function* decodePointLines(lines: AsyncIterable<string>): AsyncIterable<Point> {
  let header = true;
  for await (const line of lines) {
    if (header) {
      header = false;
      continue;
    }
    const [step, value] = line.split(",");
    yield { step: Number(step), value: Number(value) };
  }
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
  it("merges streaming overrides with query-level transport options", async () => {
    const fetch: typeof globalThis.fetch = async (input) => response(stepFrom(input));
    const query = new Query(http(fetch), OPTIONS, { timeout: 0 });

    await expect(collect(query.stream({ timeout: 1_000 }))).resolves.toHaveLength(2);
  });

  it("yields rows from a response body before it has finished arriving", async () => {
    /* The server writes the CSV row by row over a chunked response, so a
     * streaming query must surface early rows without waiting for the last
     * byte. The second chunk is withheld until the first row is observed.
     */
    let releaseTail: () => void;
    const tail = new Promise<void>((resolve) => {
      releaseTail = resolve;
    });

    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode("step,value\n1,10\n"));
        await tail;
        controller.enqueue(encoder.encode("2,20\n"));
        controller.close();
      },
    });

    const options: QueryOptions<Point> = {
      requests: [{ path: "/api/v1/test", params: { step: 1 } }],
      decode: () => [],
      decodeLines: decodePointLines,
    };
    const query = new Query(
      http(async () => new Response(body)),
      options,
    );

    const iterator = query.stream()[Symbol.asyncIterator]();
    const first = await iterator.next();

    expect(first.value).toEqual({ step: 1, value: 10 });

    releaseTail!();
    await expect(collect({ [Symbol.asyncIterator]: () => iterator })).resolves.toEqual([
      { step: 2, value: 20 },
    ]);
  });
});
