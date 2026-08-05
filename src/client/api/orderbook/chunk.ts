import { assert } from "../../../util/assert.ts";
import { MAX_REQUESTS_PER_QUERY } from "../../query/query.ts";
import { chunkByStep, type TimeRange } from "../../time/range.ts";

/* The server rejects requests spanning more buckets with an HTTP 403, so
 * chunking is mandatory rather than an optimization.
 */
export const MAX_BUCKETS_PER_REQUEST = 512;

/**
 * Splits an aligned range into contiguous requests that fit the bucket cap.
 *
 * @param range - The aligned time range.
 * @param minutes - The bucket size in minutes.
 * @returns Half-open, contiguous chunks covering the range in order.
 * @throws {@link VeloError} when the range is empty or needs more requests
 * than {@link MAX_REQUESTS_PER_QUERY}.
 */
export function chunkBuckets(range: TimeRange, minutes: number): TimeRange[] {
  assert(
    Number.isInteger(minutes) && minutes > 0,
    `Invalid bucket size ${minutes}: expected a positive minute count`,
  );

  const stepMs = MAX_BUCKETS_PER_REQUEST * minutes * 60_000;
  return chunkByStep(
    range,
    stepMs,
    (requestCount) =>
      `Orderbook query requires ${requestCount} HTTP requests, exceeding the limit of ` +
      `${MAX_REQUESTS_PER_QUERY}; narrow the time range or use a coarser resolution`,
  );
}
