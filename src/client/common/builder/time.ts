import { Duration, type DurationUnit } from "luxon";

import { assert } from "../../../util/assert.js";

const LAST_UNITS = {
  m: "minutes",
  h: "hours",
  D: "days",
  W: "weeks",
} as const satisfies Record<string, DurationUnit>;

/** A positive whole-number duration in minutes, hours, days, or weeks. */
export type LastDuration = `${number}${keyof typeof LAST_UNITS}`;

export type BuilderTime =
  | { readonly kind: "between"; readonly begin: number; readonly end: number }
  | { readonly kind: "last"; readonly milliseconds: number };

const LAST_PATTERN = /^(\d+)(m|h|D|W)$/;

export function betweenTime(begin: number | Date, end: number | Date): BuilderTime {
  return {
    kind: "between",
    begin: timestamp(begin),
    end: timestamp(end),
  };
}

export function lastTime(duration: LastDuration): BuilderTime {
  const match = LAST_PATTERN.exec(duration);
  assert(
    match !== null,
    `Invalid last duration ${JSON.stringify(duration)}: expected a positive integer followed by m, h, D, or W`,
  );
  const count = Number(match[1]);
  assert(
    count > 0 && Number.isSafeInteger(count),
    `Invalid last duration ${JSON.stringify(duration)}: expected a positive safe duration`,
  );
  const unit = LAST_UNITS[match[2] as keyof typeof LAST_UNITS];
  const milliseconds = Duration.fromObject({ [unit]: count }).toMillis();
  assert(
    Number.isSafeInteger(milliseconds),
    `Invalid last duration ${JSON.stringify(duration)}: expected a positive safe duration`,
  );
  return { kind: "last", milliseconds };
}

export function lowerTime(
  time?: BuilderTime,
): Partial<{ readonly begin: number; readonly end: number }> {
  if (time?.kind === "between") return { begin: time.begin, end: time.end };
  if (time?.kind === "last") {
    const end = Date.now();
    return { begin: end - time.milliseconds, end };
  }
  return {};
}

function timestamp(value: number | Date): number {
  return value instanceof Date ? value.getTime() : value;
}
