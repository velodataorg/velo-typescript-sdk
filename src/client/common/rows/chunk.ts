import { DateTime } from "luxon";

import { assert } from "../../../util/assert.ts";
import { BASIS_COLUMN } from "../market/columns.ts";
import { MAX_REQUESTS_PER_QUERY } from "../query.ts";
import { chunkByStep, type TimeRange } from "../time/range.ts";
import { toResolutionValue } from "../time/resolution.ts";
import type { RowsQueryParams } from "./params.ts";

export const MAX_CELLS_PER_REQUEST = 22_500;

const BASIS_EXCHANGE_COUNT = 3;

/**
 * Splits an aligned range into contiguous requests that fit the API limit.
 */
export function chunkRange(params: RowsQueryParams, range: TimeRange): TimeRange[] {
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
  return chunkByStep(range, stepMs, (requestCount) =>
    rowsRequestLimitMessage(String(requestCount)),
  );
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

function rowsRequestLimitMessage(requestCount: string): string {
  return (
    `Rows query requires ${requestCount} HTTP requests, exceeding the limit of ` +
    `${MAX_REQUESTS_PER_QUERY}; narrow the time range, use a coarser resolution, or reduce ` +
    `query width`
  );
}
