import { describe, expect, expectTypeOf, it } from "vitest";

import { isListed } from "./array.ts";

const METRICS = ["coins", "dollars"] as const;

describe("isListed", () => {
  it("accepts a member and rejects anything else", () => {
    expect(isListed(METRICS, "coins")).toBe(true);
    expect(isListed(METRICS, "Coins")).toBe(false);
    expect(isListed(METRICS, "")).toBe(false);
    expect(isListed([], "coins")).toBe(false);
  });

  it("narrows the value to the list's members", () => {
    const value: string = "coins";
    if (isListed(METRICS, value)) expectTypeOf(value).toEqualTypeOf<"coins" | "dollars">();
  });
});
