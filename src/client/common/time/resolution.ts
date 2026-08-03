import { z } from "zod";

import { assert } from "../../../util/assert.ts";

export type ResolutionValue =
  | { readonly unit: "minutes"; readonly count: number }
  | { readonly unit: "months"; readonly count: number };

export const RESOLUTIONS = {
  "1m": { unit: "minutes", count: 1 },
  "5m": { unit: "minutes", count: 5 },
  "10m": { unit: "minutes", count: 10 },
  "15m": { unit: "minutes", count: 15 },
  "30m": { unit: "minutes", count: 30 },
  "1h": { unit: "minutes", count: 60 },
  "2h": { unit: "minutes", count: 120 },
  "4h": { unit: "minutes", count: 240 },
  "6h": { unit: "minutes", count: 360 },
  "12h": { unit: "minutes", count: 720 },
  "1D": { unit: "minutes", count: 1_440 },
  "1W": { unit: "minutes", count: 10_080 },
  "1M": { unit: "months", count: 1 },
} as const satisfies Record<string, ResolutionValue>;

export type Resolution = keyof typeof RESOLUTIONS;

const RESOLUTION_NAMES = Object.keys(RESOLUTIONS) as [Resolution, ...Resolution[]];

export const ResolutionSchema = z.enum(RESOLUTION_NAMES);

/**
 * Resolution names that lower to a fixed minute count, for endpoints that
 * take a minute-denominated bucket size and cannot serve calendar months.
 */
export type MinuteResolution = {
  [K in Resolution]: (typeof RESOLUTIONS)[K] extends { unit: "minutes" } ? K : never;
}[Resolution];

/* The cast only asserts non-emptiness: the filter's unit predicate is the
 * same one the MinuteResolution type is derived from.
 */
const MINUTE_RESOLUTION_NAMES = RESOLUTION_NAMES.filter(
  (name) => RESOLUTIONS[name].unit === "minutes",
) as [MinuteResolution, ...MinuteResolution[]];

export const MinuteResolutionSchema = z.enum(MINUTE_RESOLUTION_NAMES);

/**
 * Looks up the bucket size represented by a public resolution name.
 */
export function toResolutionValue(resolution: Resolution): ResolutionValue {
  const value = Object.hasOwn(RESOLUTIONS, resolution) ? RESOLUTIONS[resolution] : undefined;
  assert(
    value !== undefined,
    `Invalid resolution ${JSON.stringify(resolution)}: expected one of ${RESOLUTION_NAMES.join(", ")}`,
  );
  return value;
}
