import { z } from "zod";

import { numberOrNull, timestamp } from "../../decode/types.js";

export const MarketCapSchema = z.strictObject({
  coin: z.string().min(1),
  time: timestamp,
  circ: numberOrNull,
  circ_dollars: numberOrNull,
  fdv: numberOrNull,
  fdv_dollars: numberOrNull,
});

export const CAPS_COLUMNS = Object.keys(MarketCapSchema.shape) as (keyof MarketCap)[];

export type MarketCap = z.output<typeof MarketCapSchema>;
