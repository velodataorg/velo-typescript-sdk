import { z } from "zod";

const TimestampSchema = z.int().nonnegative();

export const NewsStorySchema = z.object({
  id: z.int(),
  time: TimestampSchema,
  effectiveTime: TimestampSchema,
  effectivePrice: z.number().nullable(),
  headline: z.string(),
  source: z.string().nullable(),
  priority: z.int(),
  coins: z.array(z.string()),
  summary: z.string().nullable(),
  link: z.string().nullable(),
});

export const NewsResponseSchema = z.object({
  stories: z.array(NewsStorySchema),
});

/* One news story returned by the historical and live News APIs. */
export type NewsStory = z.infer<typeof NewsStorySchema>;
