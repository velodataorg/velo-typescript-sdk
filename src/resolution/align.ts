import { DateTime } from "luxon";

import { assert } from "../util/assert.js";
import type { Resolution } from "./resolution.js";
import { resolutionValue } from "./resolution.js";

export interface TimeRange {
  /* Start of the time range as a millisecond timestamp (inclusive). */
  begin: number;
  /* End of the time range as a millisecond timestamp (exclusive). */
  end: number;
}

/**
 * Aligns the range to whole calendar units in UTC.
 *
 * @param range - The range to align.
 * @param unit - The calendar unit to snap to.
 * @returns The range with begin floored and end ceiled to `unit` boundaries.
 */
function alignToCalendar(range: TimeRange, unit: "week" | "month"): TimeRange {
  const begin = DateTime.fromMillis(range.begin, { zone: "utc" }).startOf(unit);
  const end = DateTime.fromMillis(range.end, { zone: "utc" });
  const floored = end.startOf(unit);
  const ceiled = floored.toMillis() === end.toMillis() ? end : floored.plus({ [unit]: 1 });

  return { begin: begin.toMillis(), end: ceiled.toMillis() };
}

/**
 * Aligns a range to whole resolution buckets, widening it: begin floors and
 * end ceils to the nearest bucket boundary.
 *
 * @remarks
 * Minute-based resolutions align to epoch multiples of the bucket length;
 * `1W` aligns to calendar weeks and month resolutions to calendar months,
 * both in UTC.
 *
 * @param range - The range to align, as millisecond timestamps.
 * @param resolution - The resolution whose buckets the range snaps to.
 * @returns The aligned range; it always contains the input range.
 * @throws If begin is not a non-negative integer, or end is not an integer
 * after begin.
 */
export function alignRange(range: TimeRange, resolution: Resolution): TimeRange {
  const { begin, end } = range;
  assert(
    Number.isInteger(begin) && begin >= 0,
    `invalid begin ${begin}: must be a millisecond timestamp`,
  );
  assert(
    Number.isInteger(end) && end > begin,
    `invalid end ${end}: must be a millisecond timestamp after begin`,
  );

  const value = resolutionValue(resolution);
  if (value.unit === "months") return alignToCalendar(range, "month");
  if (resolution === "1W") return alignToCalendar(range, "week");

  const step = value.count * 60_000;
  return {
    begin: begin - (begin % step),
    end: end % step === 0 ? end : end - (end % step) + step,
  };
}
