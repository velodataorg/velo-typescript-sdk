import { describe, expect, it } from "vitest";

import { VeloError } from "../errors.ts";
import { frameText } from "./frame.ts";

describe("frameText", () => {
  it("returns strings and decodes binary frames", () => {
    expect(frameText("plain")).toBe("plain");
    const bytes = new TextEncoder().encode("payload");
    expect(frameText(bytes.buffer)).toBe("payload");
    expect(frameText(bytes)).toBe("payload");
    expect(frameText(Buffer.from("payload"))).toBe("payload");
  });

  it("respects a view's offset and length", () => {
    const shifted = new TextEncoder().encode("xxpayloadxx").subarray(2, 9);
    expect(frameText(shifted)).toBe("payload");
  });

  it("rejects non-text frame data", () => {
    for (const data of [null, undefined, 42, {}, ["text"]]) {
      expect(() => frameText(data)).toThrow(VeloError);
      expect(() => frameText(data)).toThrow(/expected text/);
    }
  });
});
