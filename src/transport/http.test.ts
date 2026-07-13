import { describe, expect, it } from "vitest";

import { version } from "../../package.json";
import {
  VeloAuthError,
  VeloBadRequestError,
  VeloConnectionError,
  VeloError,
  VeloRateLimitError,
  VeloServerError,
  VeloTimeoutError,
} from "./error.js";
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

  it("sends basic auth as api:<key> and returns the body", async () => {
    const calls: Call[] = [];
    const t = http([() => new Response("a,b\n1,2\n")], calls);
    await expect(t.text("/api/v1/rows", { type: "spot" })).resolves.toBe("a,b\n1,2\n");
    expect(calls[0]?.headers.authorization).toBe(`Basic ${btoa("api:test_key")}`);
    expect(calls[0]?.url).toBe("https://api.velo.xyz/api/v1/rows?type=spot");
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
});
