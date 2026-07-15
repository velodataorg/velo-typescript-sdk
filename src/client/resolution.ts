import { assert } from "../util/assert.js";

export type ResolutionValue =
  | { unit: "minutes"; count: number }
  | { unit: "months"; count: number };

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
  "1D": { unit: "minutes", count: 1440 },
  "1W": { unit: "minutes", count: 10_080 },
  "1M": { unit: "months", count: 1 },
} as const satisfies Record<string, ResolutionValue>;

export type Resolution = keyof typeof RESOLUTIONS;

/** The bucket size for a resolution; throws for anything outside RESOLUTIONS. */
export function resolutionValue(resolution: Resolution): ResolutionValue {
  const value = Object.hasOwn(RESOLUTIONS, resolution) ? RESOLUTIONS[resolution] : undefined;
  assert(
    value !== undefined,
    `invalid resolution ${JSON.stringify(resolution)}: expected one of ${Object.keys(RESOLUTIONS).join(", ")}`,
  );
  return value;
}

/** The /rows wire params: resolution in minutes, or a month count with months=true. */
export function resolutionParams(resolution: Resolution): { resolution: number; months?: boolean } {
  const value = resolutionValue(resolution);
  if (value.unit === "months") return { resolution: value.count, months: true };
  return { resolution: value.count };
}
