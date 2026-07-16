import { describe, expect, it } from "vitest";

import { VeloError } from "../errors.js";
import { Http } from "../transport/http.js";
import type { PreparedParams } from "./query.js";
import { Query } from "./query.js";

/* The executor is endpoint-blind, so a made-up endpoint with placeholder
 * wire params exercises it fully; only requests.length and the schema matter.
 */
type Point = { time: number; value: number | null };

const SCHEMA = { time: "number", value: "nullable-number" } as const;

/* Two requests: enough to observe ordering, prefetching, and teardown. */
const PREPARED: PreparedParams<Point> = {
  path: "/api/v1/test",
  requests: [{ step: 1 }, { step: 2 }],
  schema: { ...SCHEMA },
};

const SINGLE: PreparedParams<Point> = {
  path: "/api/v1/test",
  requests: [{ step: 1 }],
  schema: { ...SCHEMA },
};

function http(fetchFn: typeof globalThis.fetch): Http {
  return new Http({ apiKey: "test_key", fetch: fetchFn });
}

/** A fetch that answers the n-th request (1-based) with one distinct row. */
function countingFetch(urls: string[]): typeof globalThis.fetch {
  return async (input) => {
    urls.push(String(input));
    const step = urls.length;
    return new Response(`time,value\n${step},${step * 10}\n`, { status: 200 });
  };
}

/** Drain an async iterable into an array (Array.fromAsync needs Node 22; engines allow 20). */
async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) {
    items.push(item);
  }
  return items;
}

describe("Query.execute", () => {
  it("fires every request and concatenates rows in request order", async () => {
    const urls: string[] = [];
    const rows = await new Query(http(countingFetch(urls)), PREPARED).execute();

    expect(rows).toEqual([
      { time: 1, value: 10 },
      { time: 2, value: 20 },
    ]);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("/api/v1/test?step=1");
    expect(urls[1]).toContain("step=2");
  });

  it("completes with no rows on an empty body", async () => {
    const rows = await new Query(
      http(async () => new Response("")),
      SINGLE,
    ).execute();
    expect(rows).toEqual([]);
  });

  it("rejects a response that does not match the schema", async () => {
    const bad = http(async () => new Response("time,other\n1,2\n", { status: 200 }));
    await expect(new Query(bad, SINGLE).execute()).rejects.toThrow(
      /unexpected \/api\/v1\/test response header/,
    );
  });

  it("exposes the prepared query read-only, frozen at construction", () => {
    const query = new Query(http(countingFetch([])), PREPARED);

    expect(query.prepared).toBe(PREPARED); // frozen in place, not copied
    expect(() => (query.prepared.requests as unknown[]).push({})).toThrow(TypeError);
    expect(() => {
      // @ts-expect-error prepared has no setter
      query.prepared = PREPARED;
    }).toThrow(TypeError);
  });
});

describe("Query.stream", () => {
  it("yields the same rows execute returns", async () => {
    const streamed = await collect(new Query(http(countingFetch([])), PREPARED).stream());
    const executed = await new Query(http(countingFetch([])), PREPARED).execute();

    expect(streamed).toEqual(executed);
    expect(streamed).toHaveLength(2);
  });

  it("is lazy: nothing is sent until the first next()", async () => {
    const urls: string[] = [];
    const stream = new Query(http(countingFetch(urls)), SINGLE).stream();
    expect(urls).toHaveLength(0); // creating the generator is not a request

    await stream.next();
    expect(urls).toHaveLength(1);
  });

  it("prefetches the next request while the current one is consumed, in order", async () => {
    const urls: string[] = [];
    const stream = new Query(http(countingFetch(urls)), PREPARED).stream();

    const first = await stream.next();
    expect(first.value?.value).toBe(10);
    expect(urls).toHaveLength(2); // request 2 already in flight before request 1 is drained

    const rest = await collect(stream);
    expect(rest.map((row) => row.value)).toEqual([20]);
  });

  it("aborts the in-flight prefetch when the consumer breaks early", async () => {
    const urls: string[] = [];
    const signals: AbortSignal[] = [];
    const fetchFn: typeof globalThis.fetch = async (input, init) => {
      urls.push(String(input));
      const signal = init?.signal as AbortSignal;
      signals.push(signal);
      if (urls.length === 1) {
        return new Response("time,value\n1,10\n", { status: 200 });
      }
      // request 2 hangs until aborted
      return new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    };

    for await (const row of new Query(http(fetchFn), PREPARED).stream()) {
      expect(row.value).toBe(10);
      break; // request 2 is in flight now
    }

    expect(urls).toHaveLength(2);
    expect(signals[1]?.aborted).toBe(true);
    // the swallowed prefetch rejection must not surface as an unhandled rejection,
    // which vitest would turn into a test failure
  });

  it("absorbs a prefetch failure while the consumer is paused, then rejects at next()", async () => {
    const urls: string[] = [];
    const fetchFn: typeof globalThis.fetch = async (input) => {
      urls.push(String(input));
      if (urls.length === 1) {
        return new Response("time,value\n1,10\n", { status: 200 });
      }
      return new Response("bad request", { status: 400 }); // request 2 fails fast
    };

    const stream = new Query(http(fetchFn), PREPARED).stream();
    await stream.next(); // request 1 delivered; request 2 prefetch in flight

    // The 400 lands while the generator is suspended with nothing awaiting
    // it; an unhandled rejection here would fail the test run.
    await new Promise((resolve) => setTimeout(resolve, 20));

    await expect(stream.next()).rejects.toThrow(VeloError);
  });

  it("rejects mid-stream when a later request fails, after yielding earlier rows", async () => {
    const urls: string[] = [];
    const fetchFn: typeof globalThis.fetch = async (input) => {
      urls.push(String(input));
      if (urls.length === 1) {
        return new Response("time,value\n1,10\n", { status: 200 });
      }
      return new Response("bad request", { status: 400 });
    };

    const seen: (number | null)[] = [];
    await expect(async () => {
      for await (const row of new Query(http(fetchFn), PREPARED).stream()) {
        seen.push(row.value);
      }
    }).rejects.toThrow(VeloError);
    expect(seen).toEqual([10]); // request 1 rows were delivered before the failure
  });
});
