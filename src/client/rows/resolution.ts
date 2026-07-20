import { z } from "zod";

import { assert } from "../../util/assert.js";

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
