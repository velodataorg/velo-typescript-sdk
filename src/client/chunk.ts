import { DateTime } from "luxon";

import type { TimeRange } from "../resolution/align.js";
import { resolutionValue } from "../resolution/resolution.js";
import { assert } from "../util/assert.js";
import type { RowsParams } from "./rows-params.js";
import { isBasisQuery } from "./rows-params.js";

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
  assert(
    range.begin < range.end,
    `invalid range [${range.begin}, ${range.end}): begin must be before end`,
  );

  const value = resolutionValue(params.resolution);
  const steps: TimeRange[] = [];

  if (value.unit === "months") {
    // One step per resolution-many calendar months; the server prices months
    // queries by step length, not cells.
    let cursor = DateTime.fromMillis(range.begin, { zone: "utc" });
    while (cursor.toMillis() < range.end) {
      const next = cursor.plus({ months: value.count });
      steps.push({ begin: cursor.toMillis(), end: Math.min(next.toMillis(), range.end) });
      cursor = next;
    }
  } else {
    // Fixed-width steps sized so bucket-count x exchanges x products x columns
    // stays within the server's cell budget.
    const exchanges = isBasisQuery(params) ? BASIS_EXCHANGE_COUNT : (params.exchanges?.length ?? 0);
    const selector = params.products ?? params.coins;
    const cellsPerBucket = exchanges * (selector?.length ?? 0) * params.columns.length;
    assert(
      cellsPerBucket > 0,
      "params must have exchanges, products or coins, and columns to price the query",
    );

    const bucketsPerStep = Math.floor(MAX_CELLS_PER_REQUEST / cellsPerBucket);
    assert(
      bucketsPerStep >= 1,
      `query too wide: ${cellsPerBucket} cells per bucket exceeds the server budget of ` +
        `${MAX_CELLS_PER_REQUEST}; use fewer exchanges, products, or columns`,
    );

    const stepMs = bucketsPerStep * value.count * 60_000;
    for (let begin = range.begin; begin < range.end; begin += stepMs) {
      steps.push({ begin, end: Math.min(begin + stepMs, range.end) });
    }
  }

  return steps;
}
