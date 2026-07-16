import { DateTime } from "luxon";

import { assert } from "../../util/assert.js";
import type { TimeRange } from "./align.js";
import type { RowsParams } from "./params.js";
import { toResolutionValue } from "./resolution.js";
import { isBasisQuery } from "./util.js";

/* Maximum number of cells the server accepts in a single request. */
export const MAX_CELLS_PER_REQUEST = 22_500;

/** The server always counts cells for `3m_basis_ann` queries using 3 exchanges. */
const BASIS_EXCHANGE_COUNT = 3;

/**
 * Splits an aligned time range into contiguous `[begin, end)` steps that each
 * fit the server's per-request limits.
 *
 * @remarks
 * For fixed-length resolutions, each step is sized so its cell count stays
 * within {@link MAX_CELLS_PER_REQUEST}. For the months mode, each step spans
 * resolution-many calendar months, since the server prices those queries by
 * step length rather than cells.
 *
 * @param params - Query parameters used to price each step.
 * @param range - Aligned time range to split, as `[begin, end)` epoch millis.
 * @returns Contiguous steps covering `range`; a single step when the range
 * already fits.
 * @throws If `range` is empty or inverted, or if `params` describes a query
 * too wide to fit even one bucket within the cell budget.
 */
export function chunkRange(params: RowsParams, range: TimeRange): TimeRange[] {
  assert(
    range.begin < range.end,
    `invalid range [${range.begin}, ${range.end}): begin must be before end`,
  );

  const value = toResolutionValue(params.resolution);
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
