import { DateTime } from "luxon";

import { assert } from "../../../util/assert.ts";
import { MAX_REQUESTS_PER_QUERY } from "../query.ts";
import { MAX_TIMESTAMP_MS } from "../validation.ts";
import type { Resolution } from "./resolution.ts";
import { toResolutionValue } from "./resolution.ts";

export interface TimeRange {
  readonly begin: number;
  readonly end: number;
}

/**
 * Widens a range to complete resolution buckets.
 *
 * Minute resolutions align to epoch multiples. Weeks align to UTC Mondays,
 * and months align to UTC month boundaries.
 */
export function alignRange(range: TimeRange, resolution: Resolution): TimeRange {
  const { begin, end } = range;
  assert(
    Number.isInteger(begin) && begin >= 0 && begin <= MAX_TIMESTAMP_MS,
    `Invalid begin ${begin}: expected a millisecond timestamp`,
  );
  assert(
    Number.isInteger(end) && end > begin && end <= MAX_TIMESTAMP_MS,
    `Invalid end ${end}: expected a millisecond timestamp after begin`,
  );

  const value = toResolutionValue(resolution);
  if (value.unit === "months") return alignToCalendar(range, "month");
  if (resolution === "1W") return alignToCalendar(range, "week");

  const step = value.count * 60_000;
  return {
    begin: begin - (begin % step),
    end: end % step === 0 ? end : end - (end % step) + step,
  };
}

/**
 * Splits a range into contiguous half-open chunks spanning at most `stepMs`.
 *
 * @param range - The aligned time range.
 * @param stepMs - The maximum chunk span in milliseconds.
 * @param limitMessage - Builds the failure message for the request-count cap.
 * @returns Half-open, contiguous chunks covering the range in order.
 * @throws {@link VeloError} when the range is empty, the step is not a
 * positive integer, or the range needs more requests than
 * {@link MAX_REQUESTS_PER_QUERY}.
 */
export function chunkByStep(
  range: TimeRange,
  stepMs: number,
  limitMessage: (requestCount: number) => string,
): TimeRange[] {
  assert(
    range.begin < range.end,
    `Invalid range [${range.begin}, ${range.end}): begin must be before end`,
  );
  assert(
    Number.isInteger(stepMs) && stepMs > 0,
    `Invalid step ${stepMs}: expected a positive millisecond count`,
  );

  const requestCount = Math.ceil((range.end - range.begin) / stepMs);
  assert(requestCount <= MAX_REQUESTS_PER_QUERY, () => limitMessage(requestCount));

  const chunks: TimeRange[] = [];
  for (let begin = range.begin; begin < range.end; begin += stepMs) {
    chunks.push({ begin, end: Math.min(begin + stepMs, range.end) });
  }
  return chunks;
}

/**
 * Caps a range end that alignment ceiled into the future at the current time.
 *
 * @remarks
 * Weekly and monthly alignment can ceil the end days into the future, and the
 * API rejects timestamps more than a day ahead. The response cannot contain
 * data past now anyway, so request the partial trailing bucket instead.
 *
 * @param range - The aligned time range.
 * @param requestedBegin - The begin requested before alignment, which may be
 * later than the floored `range.begin`.
 * @param now - The current millisecond timestamp.
 * @returns The range with its end capped at `now`.
 * @throws {@link VeloError} when capping is needed but the requested range
 * lies entirely in the future.
 */
export function clampEnd(range: TimeRange, requestedBegin: number, now: number): TimeRange {
  if (range.end <= now) return range;
  assert(
    requestedBegin < now,
    `Invalid begin ${requestedBegin}: the requested range is entirely in the future`,
  );
  return { begin: range.begin, end: now };
}

function alignToCalendar(range: TimeRange, unit: "week" | "month"): TimeRange {
  const begin = DateTime.fromMillis(range.begin, { zone: "utc" }).startOf(unit);
  const end = DateTime.fromMillis(range.end, { zone: "utc" });
  const floored = end.startOf(unit);
  const ceiled = floored.toMillis() === end.toMillis() ? end : floored.plus({ [unit]: 1 });

  assert(
    ceiled.isValid,
    `Invalid end ${range.end}: ceiling to the next ${unit} exceeds the representable date range`,
  );
  return { begin: begin.toMillis(), end: ceiled.toMillis() };
}
