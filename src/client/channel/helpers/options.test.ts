import { describe, expect, expectTypeOf, it } from "vitest";

import { VeloError } from "../../../errors.ts";
import { flag, option, parseOptions } from "./options.ts";

const INDICATOR = "channel.example";
const METRICS = ["coins", "dollars"] as const;
const OPTIONS = { metric: option(METRICS, "dollars"), weighted: flag() };

describe("parseOptions", () => {
  it("checks every entry and fills in what an omitted one means", () => {
    expect(parseOptions({ metric: "coins", weighted: true }, OPTIONS, INDICATOR)).toEqual({
      metric: "coins",
      weighted: true,
    });
    expect(parseOptions({ metric: "coins" }, OPTIONS, INDICATOR)).toEqual({
      metric: "coins",
      weighted: false,
    });
    expect(parseOptions({}, OPTIONS, INDICATOR)).toEqual({ metric: "dollars", weighted: false });
    expect(parseOptions(undefined, OPTIONS, INDICATOR)).toEqual({
      metric: "dollars",
      weighted: false,
    });
  });

  it("types each entry from its parser", () => {
    const parsed = parseOptions({}, OPTIONS, INDICATOR);
    expectTypeOf(parsed).toEqualTypeOf<{
      readonly metric: "coins" | "dollars";
      readonly weighted: boolean;
    }>();
  });

  it("reads a builder without options as having none to pass", () => {
    expect(parseOptions(undefined, {}, INDICATOR)).toEqual({});
    expect(parseOptions({}, {}, INDICATOR)).toEqual({});
    expect(() => parseOptions({ metric: "coins" }, {}, INDICATOR)).toThrow(VeloError);
  });

  it.each([null, [], "coins", 42, true])("rejects options that are not an object: %j", (input) => {
    expect(() => parseOptions(input, OPTIONS, INDICATOR)).toThrow(
      "channel.example() options must be an object",
    );
  });

  it("names the entries a builder has when one is unknown", () => {
    expect(() => parseOptions({ metrics: "coins" }, OPTIONS, INDICATOR)).toThrow(
      'channel.example() received an unknown option "metrics"; expected metric, weighted',
    );
    /* An inherited name is not an entry. */
    expect(() => parseOptions({ toString: "coins" }, OPTIONS, INDICATOR)).toThrow(
      'channel.example() received an unknown option "toString"',
    );
  });

  it("does not change what the caller passed", () => {
    const passed = Object.freeze({ metric: "coins" });
    expect(parseOptions(passed, OPTIONS, INDICATOR).weighted).toBe(false);
    expect(passed).toEqual({ metric: "coins" });
  });
});

describe("option", () => {
  const metric = option(METRICS, "dollars");

  it("yields the name chosen, or the fallback when none was", () => {
    expect(metric.parse("coins", "metric", INDICATOR)).toBe("coins");
    expect(metric.parse(undefined, "metric", INDICATOR)).toBe("dollars");
    expectTypeOf(metric.parse("coins", "metric", INDICATOR)).toEqualTypeOf<"coins" | "dollars">();
    expect(Object.isFrozen(metric)).toBe(true);
  });

  it.each(["Coins", "coin", "contracts", "", true, 0, null, ["coins"], "toString", "__proto__"])(
    "rejects a value that is not one of the names: %j",
    (value) => {
      expect(() => metric.parse(value, "metric", INDICATOR)).toThrow(VeloError);
    },
  );

  it("lists the names when the value is unknown", () => {
    expect(() => metric.parse("contracts", "metric", INDICATOR)).toThrow(
      'channel.example() received an unknown metric "contracts"; expected coins, dollars',
    );
  });

  it("refuses a fallback that is not one of its names", () => {
    // @ts-expect-error contracts is not one of the names
    expect(() => option(METRICS, "contracts")).toThrow(
      'an option falls back to "contracts", which is not one of its names',
    );
  });
});

describe("flag", () => {
  const weighted = flag();

  it("is on only for true, and off when omitted", () => {
    expect(weighted.parse(true, "weighted", INDICATOR)).toBe(true);
    expect(weighted.parse(false, "weighted", INDICATOR)).toBe(false);
    expect(weighted.parse(undefined, "weighted", INDICATOR)).toBe(false);
    expect(Object.isFrozen(weighted)).toBe(true);
  });

  it.each(["true", 1, 0, null, {}])("rejects a value that is not a boolean: %j", (value) => {
    expect(() => weighted.parse(value, "weighted", INDICATOR)).toThrow(
      `channel.example() takes a boolean for weighted (got ${JSON.stringify(value)})`,
    );
  });
});
