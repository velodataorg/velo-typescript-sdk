import { z } from "zod";

import { timestamp as timestampSchema } from "../../schema.js";

export const csvNumber = z.string().transform((raw, context) => {
  const value = Number(raw);
  if (raw !== "" && Number.isFinite(value)) return value;

  context.addIssue({
    code: "custom",
    message: "expected a finite number",
  });
  return z.NEVER;
});

export const csvTimestamp = csvNumber.pipe(timestampSchema);

export const csvBoolean = z.enum(["true", "false"]).transform((value) => value === "true");

export const csvNumberOrNull = z.string().transform((raw, context) => {
  if (raw === "" || raw === "null") return null;

  const value = Number(raw);
  if (Number.isFinite(value)) return value;

  context.addIssue({
    code: "custom",
    message: "expected a finite number or null",
  });
  return z.NEVER;
});
