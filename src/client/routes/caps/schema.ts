import { z } from "zod";

import { csvNumberOrNull, csvTimestamp } from "../../decode/schema.js";

export const MarketCapSchema = z.strictObject({
  coin: z.string().min(1),
  time: csvTimestamp,
  circ: csvNumberOrNull,
  circ_dollars: csvNumberOrNull,
  fdv: csvNumberOrNull,
  fdv_dollars: csvNumberOrNull,
});

export const CAPS_COLUMNS = Object.keys(MarketCapSchema.shape) as (keyof MarketCap)[];

export type MarketCap = z.output<typeof MarketCapSchema>;
