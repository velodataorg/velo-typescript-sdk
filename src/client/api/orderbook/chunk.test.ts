import { describe, expect, it } from "vitest";

import { VeloError } from "../../../errors.ts";
import { chunkBuckets, MAX_BUCKETS_PER_REQUEST } from "./chunk.ts";

const MINUTE = 60_000;

describe("chunkBuckets", () => {
  it("caps requests at the server's bucket limit", () => {
    expect(MAX_BUCKETS_PER_REQUEST).toBe(512);
  });

  it("chunks a long range with a clamped tail", () => {
    const stepMs = MAX_BUCKETS_PER_REQUEST * 5 * MINUTE;
    const end = 2 * stepMs + 5 * MINUTE;

    expect(chunkBuckets({ begin: 0, end }, 5)).toEqual([
      { begin: 0, end: stepMs },
      { begin: stepMs, end: 2 * stepMs },
      { begin: 2 * stepMs, end },
    ]);
  });

  it("keeps a range within the bucket cap as one request", () => {
    const end = MAX_BUCKETS_PER_REQUEST * MINUTE;

    expect(chunkBuckets({ begin: 0, end: MINUTE }, 1)).toEqual([{ begin: 0, end: MINUTE }]);
    expect(chunkBuckets({ begin: 0, end }, 1)).toEqual([{ begin: 0, end }]);
  });

  it("splits one bucket past the cap into a second contiguous request", () => {
    const capMs = MAX_BUCKETS_PER_REQUEST * MINUTE;
    const end = capMs + MINUTE;

    expect(chunkBuckets({ begin: 0, end }, 1)).toEqual([
      { begin: 0, end: capMs },
      { begin: capMs, end },
    ]);
  });

  it("scales the chunk span with the bucket size", () => {
    const capMs = MAX_BUCKETS_PER_REQUEST * 60 * MINUTE;
    const end = 2 * capMs;

    expect(chunkBuckets({ begin: 0, end }, 60)).toEqual([
      { begin: 0, end: capMs },
      { begin: capMs, end },
    ]);
  });

  it("rejects an empty or inverted range", () => {
    expect(() => chunkBuckets({ begin: MINUTE, end: MINUTE }, 1)).toThrow(VeloError);
    expect(() => chunkBuckets({ begin: 2 * MINUTE, end: MINUTE }, 1)).toThrow(
      /begin must be before end/,
    );
  });

  it("rejects a range that needs too many requests", () => {
    const end = 10_001 * MAX_BUCKETS_PER_REQUEST * MINUTE;

    expect(() => chunkBuckets({ begin: 0, end }, 1)).toThrow(
      /10001 HTTP requests, exceeding the limit of 10000/,
    );
  });

  it("rejects a fractional or non-positive bucket size", () => {
    expect(() => chunkBuckets({ begin: 0, end: MINUTE }, 1.5)).toThrow(/Invalid bucket size/);
    expect(() => chunkBuckets({ begin: 0, end: MINUTE }, 0)).toThrow(/Invalid bucket size/);
  });
});
