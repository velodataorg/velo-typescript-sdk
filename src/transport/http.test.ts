import { describe, expect, it } from "vitest";

import { version } from "../../package.json";
import {
  VeloAuthError,
  VeloBadRequestError,
  VeloConnectionError,
  VeloError,
  VeloHttpError,
  VeloRateLimitError,
  VeloRequestError,
  VeloServerError,
  VeloTimeoutError,
} from "../errors.js";
import { Http } from "./http.js";

const FAST_RETRY = { retries: 2, baseDelayMs: 1, maxDelayMs: 2 };

interface Call {
  url: string;
  headers: Record<string, string>;
}

/** A fetch stub that pops one scripted response per call and records requests. */
function fetchStub(responses: (() => Response)[], calls: Call[] = []) {
  const fetchFn: typeof globalThis.fetch = async (input, init) => {
    calls.push({
      url: String(input),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    });
    const next = responses.shift();
    if (!next) throw new Error("fetch stub exhausted");
    return next();
  };
  return { fetchFn, calls };
}

function http(responses: (() => Response)[], calls: Call[] = []) {
  const stub = fetchStub(responses, calls);
  return new Http({
    apiKey: "test_key",
    fetch: stub.fetchFn,
    retry: FAST_RETRY,
    // Pacing has its own tests below; here the default limiter would turn
    // every 429's full-window pause into a 30-second wait.
    rateLimit: false,
  });
}

/** A fetch that hangs until its signal aborts, then rejects with the abort reason. */
const hangUntilAborted: typeof globalThis.fetch = (_input, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  });

describe("Http", () => {
  it("requires an apiKey", () => {
    expect(() => new Http({ apiKey: "" })).toThrow(VeloError);
  });

  it("rejects an invalid retry config or timeout at construction", () => {
    expect(() => new Http({ apiKey: "k", retry: { retries: NaN } })).toThrow(
      /retries must be a non-negative integer/,
    );
    expect(() => new Http({ apiKey: "k", retry: { baseDelayMs: -1 } })).toThrow(VeloError);
    // AbortSignal.timeout rejects fractions, and Node timers clamp delays
    // above 2^31 - 1 to fire almost immediately
    for (const timeout of [NaN, 0, 0.5, 2 ** 31]) {
      expect(() => new Http({ apiKey: "k", timeout })).toThrow(
        /timeout must be a positive integer/,
      );
    }
  });

  it("rejects an invalid per-request override before sending anything", async () => {
    const calls: Call[] = [];
    const t = http([() => new Response("ok")], calls);
    // an explicit undefined spreads over the valid default
    const smuggled = { retries: undefined } as never;
    await expect(t.text("/x", {}, { retry: smuggled })).rejects.toThrow(
      /retries must be a non-negative integer/,
    );
    await expect(t.text("/x", {}, { timeout: 0 })).rejects.toThrow(VeloError);
    expect(calls).toHaveLength(0);
  });

  it("builds URLs with comma-joined arrays and skips undefined", () => {
    const t = new Http({ apiKey: "k" });
    expect(
      t.url("/api/v1/rows", {
        type: "futures",
        exchanges: ["binance-futures", "bybit"],
        begin: 1767225600000,
        months: undefined,
      }),
    ).toBe(
      "https://api.velo.xyz/api/v1/rows?type=futures&exchanges=binance-futures,bybit&begin=1767225600000",
    );
  });

  it("normalizes trailing slashes in a custom base URL", () => {
    for (const baseUrl of ["https://example.test/", "https://example.test///"]) {
      const t = new Http({ apiKey: "k", baseUrl });
      expect(t.url("/api/v1/rows")).toBe("https://example.test/api/v1/rows");
    }
  });

  it("sends basic auth as api:<key> and returns the body", async () => {
    const calls: Call[] = [];
    const t = http([() => new Response("a,b\n1,2\n")], calls);
    await expect(t.text("/api/v1/rows", { type: "spot" })).resolves.toBe("a,b\n1,2\n");
    expect(calls[0]?.headers.authorization).toBe(`Basic ${btoa("api:test_key")}`);
    expect(calls[0]?.url).toBe("https://api.velo.xyz/api/v1/rows?type=spot");
  });

  it("parses successful JSON responses without asserting an endpoint type", async () => {
    const t = http([() => new Response('{"stories":[{"id":1}]}')]);
    const value: unknown = await t.json("/api/n/news", { begin: 0 });
    expect(value).toEqual({ stories: [{ id: 1 }] });
  });

  it("wraps invalid JSON with the URL and parse failure", async () => {
    const calls: Call[] = [];
    const t = http([() => new Response("{not json")], calls);
    const error = await t.json("/api/n/news", { begin: 10 }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(VeloRequestError);
    expect(error).not.toHaveProperty("body");
    expect((error as VeloRequestError).url).toBe("https://api.velo.xyz/api/n/news?begin=10");
    expect((error as Error).cause).toBeInstanceOf(SyntaxError);
    expect(calls).toHaveLength(1);
  });

  it("reports the URL actually sent if JSON params are later mutated", async () => {
    let respond: ((response: Response) => void) | undefined;
    const t = new Http({
      apiKey: "test_key",
      fetch: () =>
        new Promise((resolve) => {
          respond = resolve;
        }),
    });
    const params = { begin: 10 };
    const pending = t.json("/api/n/news", params);

    params.begin = 20;
    // flush the pre-fetch awaits (rate-limit acquire) until fetch is reached
    while (!respond) {
      await Promise.resolve();
    }
    respond(new Response("{not json"));
    const error = await pending.catch((e: unknown) => e);

    expect((error as VeloRequestError).url).toBe("https://api.velo.xyz/api/n/news?begin=10");
  });

  it("maps statuses to typed errors without retrying non-retryable ones", async () => {
    for (const [status, expected] of [
      [400, VeloBadRequestError],
      [403, VeloAuthError],
    ] as const) {
      const calls: Call[] = [];
      const t = http([() => new Response("nope", { status })], calls);
      await expect(t.text("/x")).rejects.toBeInstanceOf(expected);
      expect(calls).toHaveLength(1);
    }
  });

  it("maps unlisted statuses to the base VeloHttpError", async () => {
    const t = http([() => new Response("teapot", { status: 418 })]);
    const error = await t.text("/x").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(VeloHttpError);
    expect((error as object).constructor).toBe(VeloHttpError);
    expect((error as VeloHttpError).status).toBe(418);
  });

  it("retries 429 and 5xx, then succeeds", async () => {
    const calls: Call[] = [];
    const t = http(
      [
        () => new Response("rate limited", { status: 429 }),
        () => new Response("api temporarily unavailable", { status: 503 }),
        () => new Response("ok"),
      ],
      calls,
    );
    await expect(t.text("/x")).resolves.toBe("ok");
    expect(calls).toHaveLength(3);
  });

  it("throws the typed error once retries are exhausted", async () => {
    const t = http([
      () => new Response("rate limited", { status: 429 }),
      () => new Response("rate limited", { status: 429 }),
      () => new Response("rate limited", { status: 429 }),
    ]);
    const error = await t.text("/x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VeloRateLimitError);
    expect((error as VeloRateLimitError).status).toBe(429);
    expect((error as VeloRateLimitError).body).toBe("rate limited");
  });

  it("maps 5xx to VeloServerError with request context", async () => {
    const t = http([
      () => new Response("boom", { status: 500 }),
      () => new Response("boom", { status: 500 }),
      () => new Response("boom", { status: 500 }),
    ]);
    const error = await t.text("/api/v1/terms", { coins: ["BTC"] }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VeloServerError);
    expect((error as VeloServerError).url).toBe("https://api.velo.xyz/api/v1/terms?coins=BTC");
  });

  it("aborts between retries via AbortSignal", async () => {
    const controller = new AbortController();
    const t = new Http({
      apiKey: "k",
      retry: { retries: 5, baseDelayMs: 10_000, maxDelayMs: 10_000 },
      fetch: async () => {
        controller.abort();
        return new Response("rate limited", { status: 429 });
      },
    });
    await expect(t.text("/x", {}, { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("sends a versioned user-agent", async () => {
    const calls: Call[] = [];
    const t = http([() => new Response("ok")], calls);
    await t.text("/x");
    expect(calls[0]?.headers["user-agent"]).toBe(`velo-sdk/${version}`);
  });

  it("retries network errors, then succeeds", async () => {
    const calls: Call[] = [];
    const t = http(
      [
        () => {
          throw new TypeError("fetch failed");
        },
        () => new Response("ok"),
      ],
      calls,
    );
    await expect(t.text("/x")).resolves.toBe("ok");
    expect(calls).toHaveLength(2);
  });

  it("wraps a persistent network error in VeloConnectionError with its cause", async () => {
    const boom = () => {
      throw new TypeError("fetch failed");
    };
    const t = http([boom, boom, boom]);
    const error = await t.text("/x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VeloConnectionError);
    expect((error as VeloConnectionError).url).toBe("https://api.velo.xyz/x");
    expect((error as Error).cause).toBeInstanceOf(TypeError);
  });

  it("wraps a non-Error fetch rejection in VeloConnectionError", async () => {
    /* A fetch adapter misbehaving with a bare string, not an Error. */
    const boom = (): Response => {
      throw "socket closed";
    };
    const t = http([boom, boom, boom]);
    const error = await t.text("/x").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(VeloConnectionError);
    expect((error as Error).message).toContain("socket closed");
    expect(((error as Error).cause as Error).message).toBe("socket closed");
  });

  it("redacts credentials from custom fetch errors and their causes", async () => {
    const apiKey = "test/key";
    const authToken = btoa(`api:${apiKey}`);
    const authorization = `Basic ${authToken}`;
    const t = new Http({
      apiKey,
      retry: { retries: 0 },
      fetch: async () => {
        const failure = Object.assign(
          new Error(`adapter failed with ${apiKey}, ${authorization}, and ${authToken}`),
          { headers: { authorization } },
        );
        failure.name = `Adapter${authToken}`;
        throw failure;
      },
    });

    const error = await t.text("/x").catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(VeloConnectionError);
    const cause = (error as Error).cause as Error;
    const surfaced = [
      (error as Error).message,
      (error as Error).stack,
      cause.name,
      cause.message,
      cause.stack,
    ].join("\n");
    expect(surfaced).toContain("[REDACTED]");
    expect(surfaced).not.toContain(apiKey);
    expect(surfaced).not.toContain(authToken);
    expect(cause).not.toHaveProperty("headers");
  });

  it("times out a hung attempt and maps it to VeloTimeoutError", async () => {
    const t = new Http({
      apiKey: "k",
      fetch: hangUntilAborted,
      retry: { ...FAST_RETRY, retries: 0 },
    });
    const error = await t.text("/x", {}, { timeout: 5 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VeloTimeoutError);
    expect((error as VeloTimeoutError).timeout).toBe(5);
  });

  it("retries after a timeout, then succeeds", async () => {
    let attempts = 0;
    const t = new Http({
      apiKey: "k",
      retry: FAST_RETRY,
      fetch: (input, init) => {
        attempts++;
        return attempts === 1 ? hangUntilAborted(input, init) : Promise.resolve(new Response("ok"));
      },
    });
    await expect(t.text("/x", {}, { timeout: 5 })).resolves.toBe("ok");
    expect(attempts).toBe(2);
  });

  it("propagates a user abort untouched during an in-flight request", async () => {
    const controller = new AbortController();
    const cancelled = new Error("user cancelled");
    const t = new Http({
      apiKey: "k",
      retry: FAST_RETRY,
      fetch: (input, init) => {
        const pending = hangUntilAborted(input, init);
        controller.abort(cancelled);
        return pending;
      },
    });
    const error = await t.text("/x", {}, { signal: controller.signal }).catch((e: unknown) => e);
    expect(error).toBe(cancelled);
  });

  it("honors per-request retry overrides", async () => {
    const calls: Call[] = [];
    const t = http(
      [() => new Response("rate limited", { status: 429 }), () => new Response("ok")],
      calls,
    );
    await expect(t.text("/x", {}, { retry: { retries: 0 } })).rejects.toBeInstanceOf(
      VeloRateLimitError,
    );
    expect(calls).toHaveLength(1);
  });

  it("retries 408, then succeeds", async () => {
    const calls: Call[] = [];
    const t = http(
      [() => new Response("request timeout", { status: 408 }), () => new Response("ok")],
      calls,
    );
    await expect(t.text("/x")).resolves.toBe("ok");
    expect(calls).toHaveLength(2);
  });

  it("honors an HTTP-date Retry-After", async () => {
    const calls: Call[] = [];
    const t = http(
      [
        () =>
          new Response("rate limited", {
            status: 429,
            headers: { "retry-after": new Date(Date.now() + 10).toUTCString() },
          }),
        () => new Response("ok"),
      ],
      calls,
    );
    await expect(t.text("/x")).resolves.toBe("ok");
    expect(calls).toHaveLength(2);
  });

  it("exposes retryAfterMs and headers on rate-limit errors", async () => {
    const t = http([
      () => new Response("rate limited", { status: 429, headers: { "retry-after": "7" } }),
    ]);
    const error = await t.text("/x", {}, { retry: { retries: 0 } }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VeloRateLimitError);
    expect((error as VeloRateLimitError).retryAfterMs).toBe(7000);
    expect((error as VeloRateLimitError).headers?.["retry-after"]).toBe("7");
  });

  it("rejects an invalid rate-limit config at construction", () => {
    expect(() => new Http({ apiKey: "k", rateLimit: { requests: 0 } })).toThrow(
      /requests must be a positive integer/,
    );
    expect(() => new Http({ apiKey: "k", rateLimit: { windowMs: 0 } })).toThrow(VeloError);
  });

  it("paces requests beyond the rate-limit budget", async () => {
    const calls: Call[] = [];
    const stub = fetchStub(
      [() => new Response("ok"), () => new Response("ok"), () => new Response("ok")],
      calls,
    );
    const t = new Http({
      apiKey: "k",
      fetch: stub.fetchFn,
      rateLimit: { requests: 2, windowMs: 25 },
    });
    const start = Date.now();
    await t.text("/x");
    await t.text("/x");
    // the third send exceeds the budget and must wait out the 25ms window
    await t.text("/x");
    expect(Date.now() - start).toBeGreaterThanOrEqual(20);
    expect(calls).toHaveLength(3);
  });

  it("paces retry attempts like first attempts", async () => {
    // A budget of one per window forces the 503 retry to wait out the window
    // even though its backoff is ~1ms.
    const stub = fetchStub([
      () => new Response("api temporarily unavailable", { status: 503 }),
      () => new Response("ok"),
    ]);
    const t = new Http({
      apiKey: "k",
      fetch: stub.fetchFn,
      retry: FAST_RETRY,
      rateLimit: { requests: 1, windowMs: 25 },
    });
    const start = Date.now();
    await expect(t.text("/x")).resolves.toBe("ok");
    expect(Date.now() - start).toBeGreaterThanOrEqual(20);
  });

  it("pauses a full window after a 429", async () => {
    // The budget below leaves four slots free, so only the 429's penalize()
    // can be what defers the retry.
    const stub = fetchStub([
      () => new Response("rate limited", { status: 429 }),
      () => new Response("ok"),
    ]);
    const t = new Http({
      apiKey: "k",
      fetch: stub.fetchFn,
      retry: FAST_RETRY,
      rateLimit: { requests: 5, windowMs: 25 },
    });
    const start = Date.now();
    await expect(t.text("/x")).resolves.toBe("ok");
    expect(Date.now() - start).toBeGreaterThanOrEqual(20);
  });

  it("propagates a user abort during the rate-limit wait", async () => {
    const calls: Call[] = [];
    const stub = fetchStub([() => new Response("ok")], calls);
    const t = new Http({
      apiKey: "k",
      fetch: stub.fetchFn,
      rateLimit: { requests: 1, windowMs: 30_000 },
    });
    await t.text("/x");

    const controller = new AbortController();
    const cancelled = new Error("user cancelled");
    const pending = t.text("/x", {}, { signal: controller.signal });
    controller.abort(cancelled);
    await expect(pending).rejects.toBe(cancelled);
    // the aborted request never reached fetch
    expect(calls).toHaveLength(1);
  });

  it("sends without pacing when rateLimit is false", async () => {
    // one request past the default budget, which pacing would hold for ~30s
    const count = 61;
    const responses = Array.from({ length: count }, () => () => new Response("ok"));
    const calls: Call[] = [];
    const t = new Http({
      apiKey: "k",
      fetch: fetchStub(responses, calls).fetchFn,
      rateLimit: false,
    });
    for (let i = 0; i < count; i++) {
      await t.text("/x");
    }
    expect(calls).toHaveLength(count);
  });
});
