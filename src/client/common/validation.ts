import { z } from "zod";

import { VeloError } from "../../errors.ts";

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

/**
 * Builds the standard error for one endpoint's rejected params.
 *
 * @param label - The params owner named in the message, e.g. `futures`.
 * @param error - The Zod error produced by the schema.
 */
export function invalidParamsError(label: string, error: z.ZodError): VeloError {
  return new VeloError(`Invalid ${label} params:\n${z.prettifyError(error)}`);
}

/* Refine arguments asserting a half-open range's end follows its begin;
 * spread into `.refine(...END_AFTER_BEGIN)`.
 */
export const END_AFTER_BEGIN: [
  check: (range: { readonly begin: number; readonly end: number }) => boolean,
  params: { path: ["end"]; message: string },
] = [
  (range) => range.end > range.begin,
  { path: ["end"], message: "must be a millisecond timestamp after begin" },
];
