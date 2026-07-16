import { DateTime } from "luxon";

import { assert } from "../../util/assert.js";
import type { Resolution } from "./resolution.js";
import { toResolutionValue } from "./resolution.js";

export interface TimeRange {
  /* Start of the time range as a millisecond timestamp (inclusive). */
  begin: number;
  /* End of the time range as a millisecond timestamp (exclusive). */
  end: number;
}

/* The largest millisecond timestamp a Date can represent; Luxon silently
 * turns anything past it into an Invalid DateTime with NaN millis.
 */
const MAX_TIMESTAMP_MS = 8.64e15;

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
 * @throws If begin is not an integer within the representable date range
 * (0 to 8.64e15), end is not one after begin, or ceiling end to a calendar
 * boundary crosses that range.
 */
export function alignRange(range: TimeRange, resolution: Resolution): TimeRange {
  const { begin, end } = range;
  assert(
    Number.isInteger(begin) && begin >= 0 && begin <= MAX_TIMESTAMP_MS,
    `invalid begin ${begin}: must be a millisecond timestamp`,
  );
  assert(
    Number.isInteger(end) && end > begin && end <= MAX_TIMESTAMP_MS,
    `invalid end ${end}: must be a millisecond timestamp after begin`,
  );

  const value = toResolutionValue(resolution);

  if (value.unit === "months") {
    return alignToCalendar(range, "month");
  } else if (resolution === "1W") {
    return alignToCalendar(range, "week");
  } else {
    const step = value.count * 60_000;
    return {
      begin: begin - (begin % step),
      end: end % step === 0 ? end : end - (end % step) + step,
    };
  }
}

/**
 * Aligns the range to whole calendar units in UTC.
 *
 * @param range - The range to align.
 * @param unit - The calendar unit to snap to.
 * @returns The range with begin floored and end ceiled to `unit` boundaries.
 * @throws If ceiling end crosses the maximum representable date.
 */
function alignToCalendar(range: TimeRange, unit: "week" | "month"): TimeRange {
  const begin = DateTime.fromMillis(range.begin, { zone: "utc" }).startOf(unit);
  const end = DateTime.fromMillis(range.end, { zone: "utc" });
  const floored = end.startOf(unit);
  const ceiled = floored.toMillis() === end.toMillis() ? end : floored.plus({ [unit]: 1 });
  // Flooring moves toward zero, but the ceiling can cross the maximum
  // representable date, where Luxon silently yields an Invalid DateTime.
  assert(
    ceiled.isValid,
    `invalid end ${range.end}: ceiling to the next ${unit} exceeds the representable date range`,
  );

  return { begin: begin.toMillis(), end: ceiled.toMillis() };
}
