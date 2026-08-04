import { z } from "zod";

import { invalidParamsError } from "../../validation.ts";

export interface MarketCapsParams {
  readonly coins: readonly string[];
}

const MarketCapsParamsSchema = z.strictObject({
  coins: z.array(z.string().min(1)).min(1),
});

export const MarketCapsParams = Object.freeze({
  /** Validates market-caps parameters. */
  parse(params: MarketCapsParams): MarketCapsParams {
    const parsed = MarketCapsParamsSchema.safeParse(params);
    if (!parsed.success) {
      throw invalidParamsError("market-caps", parsed.error);
    }
    return parsed.data;
  },
});
