import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { VeloError } from "../../../errors.ts";
import { decodeNewsMessage, frameText } from "./decode.ts";

const STORY = {
  id: 1646,
  time: 1765554594943,
  effectiveTime: 1765554594943,
  effectivePrice: 29.058,
  headline: "Hyperliquid To Introduce Portfolio Margin",
  source: "Team",
  priority: 2,
  coins: ["HYPE"],
  summary: "Portfolio margin is coming.",
  link: "https://t.me/hyperliquid_announcements",
} as const;

describe("decodeNewsMessage", () => {
  it("decodes story, edit, delete, and heartbeat frames", () => {
    expect(decodeNewsMessage(JSON.stringify(STORY))).toEqual({ type: "story", story: STORY });
    expect(decodeNewsMessage(JSON.stringify({ ...STORY, futureField: true }))).toEqual({
      type: "story",
      story: STORY,
    });
    expect(decodeNewsMessage(JSON.stringify({ ...STORY, edit: true }))).toEqual({
      type: "edit",
      story: STORY,
    });
    expect(decodeNewsMessage(JSON.stringify({ id: STORY.id, deleted: true }))).toEqual({
      type: "delete",
      id: STORY.id,
    });
    expect(decodeNewsMessage('{"heartbeat":true}')).toEqual({ type: "heartbeat" });
  });

  it("rejects malformed JSON, schemas, false markers, and conflicting markers", () => {
    const invalid = [
      "{not json",
      "null",
      '{"heartbeat":false}',
      '{"heartbeat":true,"id":1}',
      '{"deleted":true,"id":"1646"}',
      '{"id":1646}',
      JSON.stringify({ ...STORY, edit: false }),
      JSON.stringify({ ...STORY, edit: true, deleted: true }),
    ];

    for (const frame of invalid) {
      expect(() => decodeNewsMessage(frame)).toThrow(VeloError);
    }

    try {
      decodeNewsMessage(JSON.stringify({ ...STORY, edit: true, deleted: true }));
    } catch (error) {
      expect((error as Error).cause).toBeInstanceOf(ZodError);
      expect((error as Error).message).toMatch(/conflicting event markers/);
    }
  });
});

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
