import { z } from "zod";

import { NEWS_PATH } from "../../../constants/endpoints.ts";
import { VeloError } from "../../../errors.ts";
import type { HttpParams } from "../../../transport/http.ts";
import type { QueryPlan } from "../../common/query.ts";
import { NewsStoriesParams } from "./params.ts";
import { newsResponseSchema, type NewsStory } from "./validation.ts";

/** Plans a historical-news query from raw endpoint parameters. */
export function planNewsStories(params: NewsStoriesParams): QueryPlan<NewsStory> {
  const parsed = NewsStoriesParams.parse(params);

  return {
    requests: [{ path: NEWS_PATH, params: toHttpParams(parsed) }],
    decode: decodeNewsStories,
  };
}

function toHttpParams(params: NewsStoriesParams): HttpParams {
  return params.begin === undefined ? {} : { begin: params.begin };
}

/** Parses and validates one historical-news response. */
function decodeNewsStories(body: string): NewsStory[] {
  let value: unknown;
  try {
    value = JSON.parse(body) as unknown;
  } catch (cause) {
    throw new VeloError(`unexpected ${NEWS_PATH} response: invalid JSON`, { cause });
  }

  const result = newsResponseSchema.safeParse(value);
  if (!result.success) {
    throw new VeloError(`unexpected ${NEWS_PATH} response:\n${z.prettifyError(result.error)}`, {
      cause: result.error,
    });
  }
  return result.data.stories;
}
