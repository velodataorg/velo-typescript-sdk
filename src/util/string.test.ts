import { describe, expect, expectTypeOf, it } from "vitest";

import { isNonEmptyString } from "./string.ts";

describe("isNonEmptyString", () => {
  it.each(["BTC", " ", "0", "币安人生"])("accepts a string with something in it: %j", (value) => {
    expect(isNonEmptyString(value)).toBe(true);
  });

  it.each(["", 0, 42, true, null, undefined, [], ["BTC"], {}])(
    "rejects what is empty or not a string: %j",
    (value) => {
      expect(isNonEmptyString(value)).toBe(false);
    },
  );

  it("narrows the value to a string", () => {
    const value: unknown = "BTC";
    if (isNonEmptyString(value)) expectTypeOf(value).toEqualTypeOf<string>();
  });
});
