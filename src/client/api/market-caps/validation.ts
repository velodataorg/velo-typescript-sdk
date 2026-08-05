import { z } from "zod";

import { csvNumberOrNull, csvTimestamp } from "../../decode/csv.ts";

export const marketCapSchema = z.strictObject({
  coin: z.string().min(1),
  time: csvTimestamp,
  circ: csvNumberOrNull,
  circ_dollars: csvNumberOrNull,
  fdv: csvNumberOrNull,
  fdv_dollars: csvNumberOrNull,
});

export type MarketCap = z.output<typeof marketCapSchema>;

export const MARKET_CAPS_COLUMNS = Object.keys(marketCapSchema.shape) as (keyof MarketCap)[];
