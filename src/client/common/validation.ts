import { z } from "zod";

export const MAX_TIMESTAMP_MS = 8.64e15;

/** A non-negative integer within JavaScript's representable date range. */
export const timestamp = z.number().int().nonnegative().max(MAX_TIMESTAMP_MS);

/** Creates a required, duplicate-free array schema. */
export function uniqueArray<Item extends z.ZodType>(item: Item) {
  return z
    .array(item)
    .min(1)
    .refine((items) => new Set(items).size === items.length, {
      message: "must not contain duplicates",
    });
}
