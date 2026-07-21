import { z } from "zod";

import { csvNumberOrNull, csvTimestamp } from "../../decode/schema.js";

export const TERMS_COINS = ["BTC", "ETH"] as const;
export type TermsCoin = (typeof TERMS_COINS)[number];

export const TermPointSchema = z.strictObject({
  coin: z.enum(TERMS_COINS),
  time: csvTimestamp,
  at_the_money_iv: csvNumberOrNull,
  dte: csvNumberOrNull,
  fwd_iv: csvNumberOrNull,
});

export const TERMS_COLUMNS = Object.keys(TermPointSchema.shape) as (keyof TermPoint)[];

export type TermPoint = z.output<typeof TermPointSchema>;
