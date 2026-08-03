import { describe, expect, it } from "vitest";

import { VeloError } from "../errors.ts";
import { assert } from "./assert.ts";

class CustomError extends VeloError {}

describe("assert", () => {
  it("passes truthy conditions through", () => {
    expect(() => assert(true, "unused")).not.toThrow();
    expect(() => assert(1, "unused")).not.toThrow();
    expect(() => assert("x", "unused")).not.toThrow();
  });

  it("throws VeloError with the message by default", () => {
    expect(() => assert(false, "broken")).toThrow(VeloError);
    expect(() => assert(false, "broken")).toThrow("broken");
    expect(() => assert(0, "falsy zero")).toThrow(VeloError);
  });

  it("builds lazy messages only on failure", () => {
    let built = 0;
    const message = () => {
      built++;
      return "lazy";
    };
    assert(true, message);
    expect(built).toBe(0);
    expect(() => assert(false, message)).toThrow("lazy");
    expect(built).toBe(1);
  });

  it("throws the provided error class instead of VeloError", () => {
    expect(() => assert(false, "bad", CustomError)).toThrow(CustomError);
  });

  it("narrows types", () => {
    const value: string | undefined = Math.random() < 2 ? "present" : undefined;
    assert(value !== undefined, "unreachable");
    // Compile-time check: `value` is narrowed to string here.
    expect(value.length).toBeGreaterThan(0);
  });
});
