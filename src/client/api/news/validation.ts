import { z } from "zod";

const timestampSchema = z.int().nonnegative();

export const newsStorySchema = z.object({
  id: z.int(),
  time: timestampSchema,
  effectiveTime: timestampSchema,
  effectivePrice: z.number().nullable(),
  headline: z.string(),
  source: z.string().nullable(),
  priority: z.int(),
  coins: z.array(z.string()),
  summary: z.string().nullable(),
  link: z.string().nullable(),
});

export const newsResponseSchema = z.object({
  stories: z.array(newsStorySchema),
});

/* One news story returned by the historical and live News APIs. */
export type NewsStory = z.infer<typeof newsStorySchema>;
