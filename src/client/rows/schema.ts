import { z } from "zod";

import { numberOrNull, timestamp } from "../../decode/types.js";

export const ROWS_BASE_COLUMNS = ["exchange", "coin", "product", "time"] as const;

/**
 * Creates the strict response schema for one requested column selection.
 */
export function createRowSchema<E extends string, C extends string>(
  exchanges: readonly [E, ...E[]],
  columns: readonly C[],
): z.ZodObject {
  const dataColumns = Object.fromEntries(columns.map((column) => [column, numberOrNull] as const));

  return z.strictObject({
    exchange: z.enum(exchanges),
    coin: z.string().min(1),
    product: z.string().min(1),
    time: timestamp,
    ...dataColumns,
  });
}
