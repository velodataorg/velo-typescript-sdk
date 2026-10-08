import { describe, expect, expectTypeOf, it } from "vitest";

import { isRecord } from "./object.ts";

describe("isRecord", () => {
  it.each([{}, { coin: "BTC" }, Object.create(null), new Date(0)])(
    "accepts an object to read fields from: %j",
    (value) => {
      expect(isRecord(value)).toBe(true);
    },
  );

  it.each([null, undefined, [], [{}], "BTC", 42, true, () => ({})])(
    "rejects what is not an object, and an array: %j",
    (value) => {
      expect(isRecord(value)).toBe(false);
    },
  );

  it("narrows the value so its fields read as unknown", () => {
    const value: unknown = { coin: "BTC" };
    if (isRecord(value)) expectTypeOf(value.coin).toEqualTypeOf<unknown>();
  });
});
