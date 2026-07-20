import { z } from "zod";

export const number = z.string().transform((raw, context) => {
  const value = Number(raw);
  if (raw !== "" && Number.isFinite(value)) return value;

  context.addIssue({
    code: "custom",
    message: "expected a finite number",
  });
  return z.NEVER;
});

export const timestamp = number.pipe(z.int().nonnegative());

export const boolean = z.enum(["true", "false"]).transform((value) => value === "true");

export const numberOrNull = z.string().transform((raw, context) => {
  if (raw === "" || raw === "null") return null;

  const value = Number(raw);
  if (Number.isFinite(value)) return value;

  context.addIssue({
    code: "custom",
    message: "expected a finite number or null",
  });
  return z.NEVER;
});
