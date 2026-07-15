import { DateTime } from "luxon";

import { assert } from "../util/assert.js";
import type { Resolution } from "./resolution.js";
import { resolutionValue } from "./resolution.js";

export interface TimeRange {
  /** Start of the time range as a millisecond timestamp (inclusive). */
  begin: number;
  /** End of the time range as a millisecond timestamp (exclusive). */
  end: number;
}

function alignToCalendar(range: TimeRange, unit: "week" | "month"): TimeRange {
  const begin = DateTime.fromMillis(range.begin, { zone: "utc" }).startOf(unit);
  const end = DateTime.fromMillis(range.end, { zone: "utc" });
  const floored = end.startOf(unit);
  const ceiled = floored.toMillis() === end.toMillis() ? end : floored.plus({ [unit]: 1 });

  return { begin: begin.toMillis(), end: ceiled.toMillis() };
}

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
