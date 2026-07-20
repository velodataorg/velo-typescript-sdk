import { z } from "zod";

import { numberOrNull, timestamp } from "../../decode/types.js";

export const TERMS_COINS = ["BTC", "ETH"] as const;
export type TermsCoin = (typeof TERMS_COINS)[number];

export const TermPointSchema = z.strictObject({
  coin: z.enum(TERMS_COINS),
  time: timestamp,
  at_the_money_iv: numberOrNull,
  dte: numberOrNull,
  fwd_iv: numberOrNull,
});

export const TERMS_COLUMNS = Object.keys(TermPointSchema.shape) as (keyof TermPoint)[];

export type TermPoint = z.output<typeof TermPointSchema>;
