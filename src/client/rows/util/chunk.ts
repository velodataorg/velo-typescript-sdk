import { DateTime } from "luxon";

import { assert } from "../../../util/assert.js";
import { MAX_REQUESTS_PER_QUERY } from "../../query.js";
import type { ValidatedRowsParams } from "../params.js";
import type { TimeRange } from "./align.js";
import { toResolutionValue } from "./resolution.js";

export const MAX_CELLS_PER_REQUEST = 22_500;

const BASIS_COLUMN = "3m_basis_ann";
const BASIS_EXCHANGE_COUNT = 3;

/**
 * Splits an aligned range into contiguous requests that fit the API limit.
 */
export function chunkRange(params: ValidatedRowsParams, range: TimeRange): TimeRange[] {
  assert(
    range.begin < range.end,
    `Invalid range [${range.begin}, ${range.end}): begin must be before end`,
  );

  const value = toResolutionValue(params.resolution);
  if (value.unit === "months") return chunkMonths(range, value.count);

  const exchanges = params.columns.includes(BASIS_COLUMN)
    ? BASIS_EXCHANGE_COUNT
    : (params.exchanges?.length ?? 0);
  const selectorCount = (params.products ?? params.coins)?.length ?? 0;
  const cellsPerBucket = exchanges * selectorCount * params.columns.length;

  assert(cellsPerBucket > 0, "Rows params must have exchanges, products or coins, and columns");

  const bucketsPerRequest = Math.floor(MAX_CELLS_PER_REQUEST / cellsPerBucket);
  assert(
    bucketsPerRequest >= 1,
    `Rows query is too wide: ${cellsPerBucket} values per bucket exceeds the API limit of ` +
      `${MAX_CELLS_PER_REQUEST}; use fewer exchanges, products, coins, or columns`,
  );

  const stepMs = bucketsPerRequest * value.count * 60_000;
  const requestCount = Math.ceil((range.end - range.begin) / stepMs);
  assertRequestCount(requestCount);

  const chunks: TimeRange[] = [];
  for (let begin = range.begin; begin < range.end; begin += stepMs) {
    chunks.push({ begin, end: Math.min(begin + stepMs, range.end) });
  }
  return chunks;
}

function chunkMonths(range: TimeRange, count: number): TimeRange[] {
  const chunks: TimeRange[] = [];
  let cursor = DateTime.fromMillis(range.begin, { zone: "utc" });

  while (cursor.toMillis() < range.end) {
    assert(chunks.length < MAX_REQUESTS_PER_QUERY, () =>
      rowsRequestLimitMessage(`more than ${MAX_REQUESTS_PER_QUERY}`),
    );
    const next = cursor.plus({ months: count });
    chunks.push({
      begin: cursor.toMillis(),
      end: Math.min(next.toMillis(), range.end),
    });
    cursor = next;
  }
  return chunks;
}

function assertRequestCount(requestCount: number): void {
  assert(requestCount <= MAX_REQUESTS_PER_QUERY, () =>
    rowsRequestLimitMessage(String(requestCount)),
  );
}

function rowsRequestLimitMessage(requestCount: string): string {
  return (
    `Rows query requires ${requestCount} HTTP requests, exceeding the limit of ` +
    `${MAX_REQUESTS_PER_QUERY}; narrow the time range, use a coarser resolution, or reduce ` +
    `query width`
  );
}
