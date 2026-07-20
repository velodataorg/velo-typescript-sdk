import { z } from "zod";

import { FUTURES_EXCHANGES, SPOT_EXCHANGES } from "../rows/types.js";

const CsvNumberSchema = z.string().transform((raw, context) => {
  const value = Number(raw);
  if (raw !== "" && Number.isFinite(value)) return value;

  context.addIssue({
    code: "custom",
    message: "expected a finite number",
  });
  return z.NEVER;
});

const CsvTimestampSchema = CsvNumberSchema.pipe(
  z
    .int({ error: "begin must be a nonnegative safe integer" })
    .nonnegative({ error: "begin must be a nonnegative safe integer" }),
);

const CatalogProductShape = {
  coin: z.string().min(1),
  product: z.string().min(1),
  begin: CsvTimestampSchema,
};

export const FutureProductSchema = z.strictObject({
  exchange: z.enum(FUTURES_EXCHANGES, {
    error: (issue) => `unknown exchange ${JSON.stringify(issue.input)}`,
  }),
  ...CatalogProductShape,
  depth: z
    .enum(["true", "false"], { error: "expected a boolean" })
    .transform((raw) => raw === "true"),
});

export const SpotProductSchema = z.strictObject({
  exchange: z.enum(SPOT_EXCHANGES, {
    error: (issue) => `unknown exchange ${JSON.stringify(issue.input)}`,
  }),
  ...CatalogProductShape,
});

export type FutureProduct = z.output<typeof FutureProductSchema>;
export type SpotProduct = z.output<typeof SpotProductSchema>;
