import { describe, expect, it } from "vitest";

import { BUILT, COIN, PERP, SPOT } from "../../../test/channels.ts";
import { channelFixture, FIXTURE_NAMES } from "../../../test/fixtures/channels.ts";
import { assert } from "../../util/assert.ts";
import { isRecord } from "../../util/object.ts";

/*
 * Every built channel against what the server really sent on it: two frames
 * either side of a minute's end, captured by `test/fixtures/capture.ts`.
 *
 * A capture changes every number, so nothing here names one. Each check holds
 * between a frame and what it decodes to, whatever the numbers are. Which
 * column a position fills is for an indicator's own test to say, against a
 * frame whose history row was looked up.
 */
const MINUTE = 60_000;
/* What a row or an entry carries that is not a column. */
const BASE = ["exchange", "coin", "product", "time"];

const ALL = Object.entries(BUILT).flatMap(([builder, built]) =>
  built.map((one) => ({ builder, name: one.name, built: one })),
);
/* The server ends the name of every channel that follows a coin this way, and of no other. */
const FOLLOWS_COIN = "#Aggregated";
const OF_PRODUCTS = ALL.filter(({ name }) => !name.endsWith(FOLLOWS_COIN));
const OF_COINS = ALL.filter(({ name }) => name.endsWith(FOLLOWS_COIN));

describe("the frames the server sends", () => {
  it("has a fixture for every built channel, and for nothing else", () => {
    expect(FIXTURE_NAMES.toSorted()).toEqual(ALL.map(({ name }) => name).toSorted());
  });

  describe.each(OF_PRODUCTS)("$builder on $name", ({ name, built }) => {
    const { minute, lastOfMinute, rollover } = channelFixture(built);
    const product = name.startsWith(`realtime_${SPOT.exchange}:`) ? SPOT : PERP;

    it("decodes the last frame of a minute to a row of that minute", () => {
      expect(built.decode(lastOfMinute)).toMatchObject({ ...product, time: minute });
    });

    it("decodes the rollover to a row of the minute after", () => {
      expect(built.decode(rollover)).toMatchObject({ ...product, time: minute + MINUTE });
    });

    it("fills its columns with every number of the payload, and nothing else", () => {
      for (const frame of [lastOfMinute, rollover]) {
        expect(columnValues(built.decode(frame))).toEqual(numbersOf(frame.d));
      }
    });
  });

  describe.each(OF_COINS)("$builder on $name", ({ built }) => {
    const { lastOfMinute, rollover } = channelFixture(built);

    it("decodes to one entry for every exchange the server sent, skipping none", () => {
      for (const frame of [lastOfMinute, rollover]) {
        const sent = Object.keys(payloadsOf(frame.d)).map((key) => key.replace("realtime_", ""));
        const entries = entriesOf(built.decode(frame));
        expect(entries.map((entry) => entry["exchange"]).toSorted()).toEqual(sent.toSorted());
      }
    });

    it("places no entry in a minute or on a product", () => {
      for (const entry of entriesOf(built.decode(lastOfMinute))) {
        expect(entry).toMatchObject(COIN);
        expect(entry).not.toHaveProperty("time");
        expect(entry).not.toHaveProperty("product");
      }
    });

    it("fills each entry's columns with every number of its exchange's payload, and nothing else", () => {
      for (const frame of [lastOfMinute, rollover]) {
        const payloads = payloadsOf(frame.d);
        for (const entry of entriesOf(built.decode(frame))) {
          const payload = payloads[`realtime_${String(entry["exchange"])}`];
          expect(columnValues(entry)).toEqual(numbersOf(payload));
        }
      }
    });
  });
});

/**
 * Reads the numbers of a payload: a bare number, or a tuple of them.
 *
 * @param payload - A product frame's `d`, or one exchange's share of a coin frame's.
 * @returns The numbers, sorted.
 * @throws A VeloError when the payload holds anything but numbers.
 */
function numbersOf(payload: unknown): number[] {
  const numbers: unknown[] = Array.isArray(payload) ? payload : [payload];
  assert(
    numbers.every((one): one is number => typeof one === "number"),
    "a payload holds something that is not a number",
  );
  return numbers.toSorted(ascending);
}

/**
 * Reads the numbers a decoded row or entry holds in its columns.
 *
 * @param row - What a frame decoded to.
 * @returns The column values, sorted.
 * @throws A VeloError when `row` is not an object, or a column is not a number.
 */
function columnValues(row: unknown): number[] {
  assert(isRecord(row), "a frame decoded to something that is not a row");
  const columns = Object.entries(row).filter(([key]) => !BASE.includes(key));
  return numbersOf(columns.map(([, value]) => value));
}

/**
 * Reads a coin frame's payload: one share per exchange, keyed `realtime_<exchange>`.
 *
 * @param payload - A coin frame's `d`.
 * @returns The shares, by key.
 * @throws A VeloError when the payload is not keyed.
 */
function payloadsOf(payload: unknown): Readonly<Record<string, unknown>> {
  assert(isRecord(payload), "a coin's frame carries no exchanges");
  return payload;
}

/**
 * Reads what a coin frame decoded to.
 *
 * @param decoded - What the frame decoded to.
 * @returns The entries.
 * @throws A VeloError when `decoded` is not a list of objects.
 */
function entriesOf(decoded: unknown): readonly Readonly<Record<string, unknown>>[] {
  assert(Array.isArray(decoded), "a coin's frame decoded to something that is not a list");
  const entries: unknown[] = decoded;
  assert(entries.every(isRecord), "a coin's frame decoded to an entry that is not an object");
  return entries;
}

/**
 * Orders numbers from the smallest.
 *
 * @param left - One number.
 * @param right - Another.
 * @returns Negative when `left` comes first.
 */
function ascending(left: number, right: number): number {
  return left - right;
}
