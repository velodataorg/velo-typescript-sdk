import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Channel, ChannelFrame } from "../../src/index.ts";
import { assert } from "../../src/util/assert.ts";
import { isRecord } from "../../src/util/object.ts";

/* What the server sent on one channel either side of a minute's end, untouched. */
export interface ChannelFixture {
  /*
   * The frame that arrived just before the rollover. The server closes every
   * minute with a frame stamped one millisecond before its end; on a
   * product's channel it holds the minute's finished candle.
   */
  readonly lastOfMinute: ChannelFrame;
  /*
   * The first frame of the minute after, which the server flags `f: true`.
   * Its `tt` does not place it: a coin's channel stamps it anywhere from a
   * millisecond before the minute ends to a second after. A product's dollar
   * open interest and dollar funding spend never carry `f`; theirs is the
   * first frame stamped in the minute after.
   */
  readonly rollover: ChannelFrame;
}

/* One file in `channels/`: every channel of one builder, captured together. */
export interface ChannelFixtureFile {
  readonly captured: string;
  /* The start of the minute that ended, in milliseconds. */
  readonly minute: number;
  readonly host: string;
  /* Keyed by wire name, which is each frame's `c`. */
  readonly channels: Readonly<Record<string, ChannelFixture>>;
}

/* A channel's fixture, with the minute its file was captured around. */
export interface LoadedFixture extends ChannelFixture {
  readonly minute: number;
}

const DIRECTORY = join(import.meta.dirname, "channels");
const FIXTURES = loadFixtures();

/* The wire name of every channel that has a fixture. */
export const FIXTURE_NAMES: readonly string[] = [...FIXTURES.keys()];

/**
 * Finds what the server sent on a channel.
 *
 * @param built - The channel, as a builder built it.
 * @returns The channel's two frames and the minute they were captured around.
 * @throws A VeloError when no fixture was captured for the channel.
 */
export function channelFixture(built: Channel): LoadedFixture {
  const fixture = FIXTURES.get(built.name);
  assert(
    fixture !== undefined,
    `no fixture for ${built.name}; capture one with test/fixtures/capture.ts`,
  );
  return fixture;
}

/**
 * Reads every file in `channels/`.
 *
 * @returns Each channel's fixture, by wire name.
 * @throws A VeloError when a file is not a fixture file, or two hold the same channel.
 */
function loadFixtures(): ReadonlyMap<string, LoadedFixture> {
  const fixtures = new Map<string, LoadedFixture>();
  for (const file of readdirSync(DIRECTORY).filter((entry) => entry.endsWith(".json"))) {
    const parsed: unknown = JSON.parse(readFileSync(join(DIRECTORY, file), "utf8"));
    assert(isRecord(parsed), `${file} is not a fixture file`);
    const { minute, channels } = parsed;
    assert(typeof minute === "number" && isRecord(channels), `${file} is not a fixture file`);

    for (const [name, frames] of Object.entries(channels)) {
      assert(!fixtures.has(name), `${name} has a fixture in two files`);
      assert(isRecord(frames), `${file}: ${name} holds no frames`);
      fixtures.set(name, {
        minute,
        lastOfMinute: parseFrame(frames["lastOfMinute"], name, file),
        rollover: parseFrame(frames["rollover"], name, file),
      });
    }
  }
  return fixtures;
}

/**
 * Checks that a value is a frame of the channel it is filed under.
 *
 * @param value - What the file holds.
 * @param name - The wire name the frame is filed under.
 * @param file - The file's name, for the context of a failure.
 * @returns The frame.
 * @throws A VeloError when the value is not a frame, or is another channel's.
 */
function parseFrame(value: unknown, name: string, file: string): ChannelFrame {
  assert(isRecord(value), `${file}: ${name} is missing a frame`);
  const { c, tt, f } = value;
  assert(c === name, `${file}: a frame of ${String(c)} is filed under ${name}`);
  assert(typeof tt === "number", `${file}: a frame of ${name} has no tt`);
  assert(f === undefined || typeof f === "boolean", `${file}: a frame of ${name} has an odd f`);
  return { ...value, c, tt, ...(f === undefined ? {} : { f }) };
}
