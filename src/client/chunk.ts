import { DateTime } from "luxon";

import type { TimeRange } from "../resolution/align.js";
import { resolutionValue } from "../resolution/resolution.js";
import { assert } from "../util/assert.js";
import type { RowsParams } from "./rows-params.js";

/** The server rejects requests whose bucket-count × exchanges × products × columns exceeds this. */
export const MAX_CELLS_PER_REQUEST = 22_500;

/** The server prices 3m_basis_ann queries at a fixed 3 exchanges, whatever is sent. */
const BASIS_EXCHANGE_COUNT = 3;

/**
 * Splits an aligned time range into contiguous [begin, end) steps that each
 * fit the server's per-request limits: the cell budget for fixed-length
 * resolutions, resolution-many calendar months for the months mode. Returns
 * a single step when the range already fits.
 */
export function chunkRange(params: RowsParams, range: TimeRange): TimeRange[] {
  const value = resolutionValue(params.resolution);

  if (value.unit === "months") {
    const steps: TimeRange[] = [];
    let cursor = DateTime.fromMillis(range.begin, { zone: "utc" });
    while (cursor.toMillis() < range.end) {
      const next = cursor.plus({ months: value.count });
      steps.push({ begin: cursor.toMillis(), end: Math.min(next.toMillis(), range.end) });
      cursor = next;
    }
    return steps;
  }

  const isBasis = (params.columns as readonly string[]).includes("3m_basis_ann");
  const exchanges = isBasis ? BASIS_EXCHANGE_COUNT : (params.exchanges?.length ?? 0);
  const selector = params.products ?? params.coins;
  const cellsPerBucket = exchanges * (selector?.length ?? 0) * params.columns.length;

  const bucketMs = value.count * 60_000;
  const buckets = Math.ceil((range.end - range.begin) / bucketMs);
  if (buckets * cellsPerBucket <= MAX_CELLS_PER_REQUEST) return [range];

  const bucketsPerStep = Math.floor(MAX_CELLS_PER_REQUEST / cellsPerBucket);
  assert(
    bucketsPerStep >= 1,
    `query too wide: ${cellsPerBucket} cells per bucket exceeds the server budget of ` +
      `${MAX_CELLS_PER_REQUEST}; use fewer exchanges, products, or columns`,
  );

  const stepMs = bucketsPerStep * bucketMs;
  const steps: TimeRange[] = [];
  for (let begin = range.begin; begin < range.end; begin += stepMs) {
    steps.push({ begin, end: Math.min(begin + stepMs, range.end) });
  }
  return steps;
}
