import { Duration, type DurationUnit } from "luxon";

import { assert } from "../../../util/assert.ts";

const LAST_UNITS = {
  m: "minutes",
  h: "hours",
  D: "days",
  W: "weeks",
} as const satisfies Record<string, DurationUnit>;

/** A positive whole-number duration in minutes, hours, days, or weeks. */
export type LastDuration = `${number}${keyof typeof LAST_UNITS}`;

const LAST_PATTERN = /^(\d+)(m|h|D|W)$/;

/**
 * Converts a compact trailing duration into milliseconds.
 *
 * @throws {@link VeloError} when the duration is malformed or overflows the
 * safe integer range.
 */
export function durationMilliseconds(duration: LastDuration): number {
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
  return milliseconds;
}

/** Converts a caller-supplied time into a millisecond timestamp. */
export function timestamp(value: number | Date): number {
  return value instanceof Date ? value.getTime() : value;
}
