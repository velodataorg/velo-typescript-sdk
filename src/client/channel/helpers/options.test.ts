import { describe, expect, expectTypeOf, it } from "vitest";

import { VeloError } from "../../../errors.ts";
import { flag, option, parseOptions } from "./options.ts";

const BUILDER = "channel.example";
const METRICS = { coins: "Coins", dollars: "Dollars" } as const;
const OPTIONS = { metric: option(METRICS, "dollars"), weighted: flag() };

describe("parseOptions", () => {
  it("checks every entry and fills in what an omitted one means", () => {
    expect(parseOptions(BUILDER, { metric: "coins", weighted: true }, OPTIONS)).toEqual({
      metric: "coins",
      weighted: true,
    });
    expect(parseOptions(BUILDER, { metric: "coins" }, OPTIONS)).toEqual({
      metric: "coins",
      weighted: false,
    });
    expect(parseOptions(BUILDER, {}, OPTIONS)).toEqual({ metric: "dollars", weighted: false });
    expect(parseOptions(BUILDER, undefined, OPTIONS)).toEqual({
      metric: "dollars",
      weighted: false,
    });
  });

  it("types each entry from its parser", () => {
    const parsed = parseOptions(BUILDER, {}, OPTIONS);
    expectTypeOf(parsed).toEqualTypeOf<{
      readonly metric: "coins" | "dollars";
      readonly weighted: boolean;
    }>();
  });

  it("reads a builder without options as having none to pass", () => {
    expect(parseOptions(BUILDER, undefined, {})).toEqual({});
    expect(parseOptions(BUILDER, {}, {})).toEqual({});
    expect(() => parseOptions(BUILDER, { metric: "coins" }, {})).toThrow(VeloError);
  });

  it.each([null, [], "coins", 42, true])("rejects options that are not an object: %j", (input) => {
    expect(() => parseOptions(BUILDER, input, OPTIONS)).toThrow(
      "channel.example() options must be an object",
    );
  });

  it("names the entries a builder has when one is unknown", () => {
    expect(() => parseOptions(BUILDER, { metrics: "coins" }, OPTIONS)).toThrow(
      'channel.example() received an unknown option "metrics"; expected metric, weighted',
    );
    /* An inherited name is not an entry. */
    expect(() => parseOptions(BUILDER, { toString: "coins" }, OPTIONS)).toThrow(
      'channel.example() received an unknown option "toString"',
    );
  });

  it("does not change what the caller passed", () => {
    const passed = Object.freeze({ metric: "coins" });
    expect(parseOptions(BUILDER, passed, OPTIONS).weighted).toBe(false);
    expect(passed).toEqual({ metric: "coins" });
  });
});

describe("option", () => {
  const metric = option(METRICS, "dollars");

  it("yields the name chosen, or the fallback when none was", () => {
    expect(metric.parse(BUILDER, "metric", "coins")).toBe("coins");
    expect(metric.parse(BUILDER, "metric", undefined)).toBe("dollars");
    expectTypeOf(metric.parse(BUILDER, "metric", "coins")).toEqualTypeOf<"coins" | "dollars">();
    expect(Object.isFrozen(metric)).toBe(true);
  });

  it.each(["Coins", "coin", "contracts", "", true, 0, null, ["coins"], "toString", "__proto__"])(
    "rejects a value that is not one of the choices: %j",
    (value) => {
      expect(() => metric.parse(BUILDER, "metric", value)).toThrow(VeloError);
    },
  );

  it("names the choices when the value is unknown", () => {
    expect(() => metric.parse(BUILDER, "metric", "contracts")).toThrow(
      'channel.example() received an unknown metric "contracts"; expected coins, dollars',
    );
  });

  it("refuses a fallback that is not one of its choices", () => {
    // @ts-expect-error contracts is not a choice
    expect(() => option(METRICS, "contracts")).toThrow(
      'an option falls back to "contracts", which is not one of its choices',
    );
  });
});

describe("flag", () => {
  const weighted = flag();

  it("is on only for true, and off when omitted", () => {
    expect(weighted.parse(BUILDER, "weighted", true)).toBe(true);
    expect(weighted.parse(BUILDER, "weighted", false)).toBe(false);
    expect(weighted.parse(BUILDER, "weighted", undefined)).toBe(false);
    expect(Object.isFrozen(weighted)).toBe(true);
  });

  it.each(["true", 1, 0, null, {}])("rejects a value that is not a boolean: %j", (value) => {
    expect(() => weighted.parse(BUILDER, "weighted", value)).toThrow(
      `channel.example() takes a boolean for weighted (got ${JSON.stringify(value)})`,
    );
  });
});
