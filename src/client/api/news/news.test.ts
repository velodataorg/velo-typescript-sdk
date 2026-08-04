import { describe, expect, expectTypeOf, it } from "vitest";
import { ZodError } from "zod";

import { VeloError, VeloRateLimitError } from "../../../errors.ts";
import { Velo } from "../../client.ts";
import type { Query } from "../../common/query.ts";
import type { QueryRequest } from "../../plan.ts";
import type { NewsStoriesBuilder } from "./builder.ts";
import type { NewsStoriesParams } from "./params.ts";
import type { NewsStory } from "./validation.ts";

const STORY = {
  id: 1646,
  time: 1765554594943,
  effectiveTime: 1765554594943,
  effectivePrice: 29.058,
  headline: "Hyperliquid To Introduce Portfolio Margin",
  source: "Team",
  priority: 2,
  coins: ["HYPE"],
  summary: "Portfolio margin is coming.",
  link: "https://t.me/hyperliquid_announcements",
} as const;

/** A Velo client whose fetch returns `body` and records request URLs. */
function velo(body: string, urls: string[] = []) {
  const fetch: typeof globalThis.fetch = async (input) => {
    urls.push(String(input));
    return new Response(body, { status: 200 });
  };
  return { velo: new Velo({ apiKey: "test_key", fetch }), urls };
}

function storiesQuery(client: Velo, params: NewsStoriesParams = {}) {
  return client.query(client.news.stories(params));
}

describe("Velo.news.stories", () => {
  it("fetches stories published after begin and validates their types", async () => {
    const { velo: client, urls } = velo(JSON.stringify({ stories: [STORY] }));
    const builder = client.news.stories({ begin: 1767225600000 });
    const request = builder.build();

    expect(request).toEqual({
      kind: "news.stories",
      params: { begin: 1767225600000 },
    });
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.params)).toBe(true);
    expect(builder.build()).toBe(request);
    expect(urls).toHaveLength(0);
    expectTypeOf(builder).toEqualTypeOf<NewsStoriesBuilder>();
    expectTypeOf(request).toEqualTypeOf<QueryRequest<"news.stories">>();

    const query = client.query(builder);
    const requestQuery = client.query(request);
    expectTypeOf(query).toEqualTypeOf<Query<NewsStory, NewsStory[]>>();
    expectTypeOf(requestQuery).toEqualTypeOf<Query<NewsStory, NewsStory[]>>();

    const stories = await query;

    expect(urls).toHaveLength(1);
    const url = new URL(urls[0] as string);
    expect(url.pathname).toBe("/api/n/news");
    expect(url.searchParams.get("begin")).toBe("1767225600000");
    expect(stories).toEqual([STORY]);

    const effectivePrice: number | null = stories[0]!.effectivePrice;
    const priority: number = stories[0]!.priority;
    const coins: string[] = stories[0]!.coins;
    expect(effectivePrice).toBe(29.058);
    expect(priority).toBe(2);
    expect(coins).toEqual(["HYPE"]);
  });

  it("omits begin by default and accepts nullable fields and an empty coins list", async () => {
    const nullable = {
      ...STORY,
      effectivePrice: null,
      source: null,
      coins: [],
      summary: null,
      link: null,
    };
    const { velo: client, urls } = velo(JSON.stringify({ stories: [nullable] }));

    await expect(storiesQuery(client)).resolves.toEqual([nullable]);
    expect(new URL(urls[0] as string).searchParams.has("begin")).toBe(false);
  });

  it("sends an explicit zero begin and accepts an empty stories array", async () => {
    const { velo: client, urls } = velo('{"stories":[]}');

    await expect(storiesQuery(client, { begin: 0 })).resolves.toEqual([]);
    expect(new URL(urls[0] as string).searchParams.get("begin")).toBe("0");
  });

  it("executes a direct news request through the central query pipeline", async () => {
    const { velo: client, urls } = velo(JSON.stringify({ stories: [STORY] }));
    const request: QueryRequest<"news.stories"> = {
      kind: "news.stories",
      params: { begin: 0 },
    };

    await expect(client.query(request)).resolves.toEqual([STORY]);
    expect(new URL(urls[0] as string).searchParams.get("begin")).toBe("0");
  });

  it("validates params synchronously before sending a request", () => {
    const { velo: client, urls } = velo(JSON.stringify({ stories: [] }));
    const invalid: unknown[] = [
      null,
      [],
      "not params",
      { begin: null },
      { begin: "0" },
      { begin: Symbol("timestamp") },
      { begin: -1 },
      { begin: 0.5 },
      { begin: Number.NaN },
      { begin: Number.MAX_SAFE_INTEGER + 1 },
    ];

    for (const params of invalid) {
      expect(() => client.news.stories(params as never)).toThrow(VeloError);
    }
    expect(urls).toHaveLength(0);
  });

  it("forwards per-request transport options", async () => {
    let calls = 0;
    const client = new Velo({
      apiKey: "test_key",
      fetch: async () => {
        calls++;
        return new Response("rate limited", { status: 429 });
      },
    });

    await expect(
      client.query(client.news.stories(), { retry: { retries: 0 } }),
    ).rejects.toBeInstanceOf(VeloRateLimitError);
    expect(calls).toBe(1);
  });

  it("rejects valid JSON whose response wrapper is malformed", async () => {
    for (const body of ["null", "[]", "{}", '{"stories":{}}']) {
      const { velo: client } = velo(body);
      const error = await Promise.resolve(storiesQuery(client)).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(VeloError);
      expect((error as Error).message).toMatch(/unexpected \/api\/n\/news response/);
      expect((error as Error).cause).toBeInstanceOf(ZodError);
    }
  });

  it("requires every known story field, including nullable ones", async () => {
    for (const field of Object.keys(STORY)) {
      const missing = { ...STORY } as Record<string, unknown>;
      delete missing[field];
      const { velo: client } = velo(JSON.stringify({ stories: [missing] }));
      await expect(storiesQuery(client)).rejects.toThrow(new RegExp(`stories\\[0\\]\\.${field}`));
    }
  });

  it("rejects fields that do not match the story contract", async () => {
    const invalidStories = [
      { ...STORY, id: 1.5 },
      { ...STORY, time: -1 },
      { ...STORY, effectiveTime: "now" },
      { ...STORY, effectivePrice: "29.058" },
      { ...STORY, headline: null },
      { ...STORY, priority: 1.5 },
      { ...STORY, coins: ["BTC", 1] },
      { ...STORY, summary: 1 },
      { ...STORY, link: false },
    ];

    for (const story of invalidStories) {
      const { velo: client } = velo(JSON.stringify({ stories: [story] }));
      await expect(storiesQuery(client)).rejects.toThrow(/unexpected \/api\/n\/news response/);
    }
  });

  it("ignores additive response fields while returning only the known contract", async () => {
    const { velo: client } = velo(
      JSON.stringify({
        stories: [{ ...STORY, futureField: true }],
        futureWrapperField: true,
      }),
    );

    const result = await storiesQuery(client);
    expect(result).toEqual([STORY]);
    expect(result[0]).not.toHaveProperty("futureField");
  });

  it("wraps invalid JSON with endpoint context", async () => {
    const { velo: client } = velo("{not json");
    const error = await Promise.resolve(storiesQuery(client)).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(VeloError);
    expect((error as Error).message).toMatch(/unexpected \/api\/n\/news response: invalid JSON/);
    expect((error as Error).cause).toBeInstanceOf(SyntaxError);
  });

  it("streams stories individually through the builder", async () => {
    const { velo: client } = velo(JSON.stringify({ stories: [STORY] }));
    const stories: NewsStory[] = [];

    for await (const story of storiesQuery(client).stream()) {
      stories.push(story);
    }

    expect(stories).toEqual([STORY]);
  });
});
