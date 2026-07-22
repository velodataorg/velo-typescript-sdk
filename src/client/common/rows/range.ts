import { DateTime } from "luxon";

import { assert } from "../../../util/assert.js";
import { MAX_TIMESTAMP_MS } from "../validation.js";
import type { Resolution } from "./resolution.js";
import { toResolutionValue } from "./resolution.js";

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
