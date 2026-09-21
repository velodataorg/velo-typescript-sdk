/*
 * Captures what the server sends on every built channel around the end of one
 * minute, and writes it as fixtures: one file per builder in `channels/`.
 *
 *   bun run test/fixtures/capture.ts [builder ...]
 *   bun run test/fixtures/capture.ts openInterest
 *
 * Run from the repository root; Bun loads VELO_API_KEY from .env. Takes up to
 * 85 seconds.
 *
 * Every channel is followed as `channels.raw(name)`, so a fixture holds what
 * the server sent whatever the decoders make of it. Nothing is written unless
 * every channel delivered both of its frames.
 */
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { channels, Velo } from "../../src/index.ts";
import type { ChannelFrame } from "../../src/index.ts";
import { isListed } from "../../src/util/array.ts";
import { assert } from "../../src/util/assert.ts";
import { BUILT } from "../channels.ts";
import type { ChannelFixture, ChannelFixtureFile } from "./channels.ts";

const HOST = "wss.velo.xyz";
const DIRECTORY = join(import.meta.dirname, "channels");

const MINUTE = 60_000;
/* A minute with less than this left is too short to count on a slow channel sending in it. */
const SHORTEST_CAPTURE = 15_000;
/* How far into the next minute to wait for every channel's first frame of it. */
const AFTER_MINUTE = 10_000;

type Builder = keyof typeof BUILT;
const BUILDERS = Object.keys(BUILT) as Builder[];

/* What has arrived on one channel so far. */
type Captured = { -readonly [Frame in keyof ChannelFixture]?: ChannelFixture[Frame] };

/**
 * Captures a minute's end on the chosen builders' channels and writes their fixtures.
 *
 * @returns A promise that resolves once every file is written.
 * @throws A VeloError when the key is missing, the server refuses a channel,
 * or a channel did not deliver both frames.
 */
async function main(): Promise<void> {
  const apiKey = process.env["VELO_API_KEY"];
  assert(
    apiKey !== undefined && apiKey !== "",
    "Add VELO_API_KEY to .env, then run from the root.",
  );
  const velo = new Velo({ apiKey, channelsBaseUrl: `https://${HOST}` });

  const builders = chosenBuilders(process.argv.slice(2));
  const names = builders.flatMap((builder) => BUILT[builder].map((built) => built.name));
  assert(new Set(names).size === names.length, "two built channels share a name");

  const { minute, captured } = await captureMinuteEnd(velo, names);
  const fixtures = new Map<string, ChannelFixture>();
  const incomplete: string[] = [];
  for (const name of names) {
    const fixture = completeFixture(name, minute, captured);
    if (typeof fixture === "string") incomplete.push(fixture);
    else fixtures.set(name, fixture);
  }
  /* Every incomplete channel at once, so one run shows all there is to learn. */
  assert(incomplete.length === 0, () => `nothing written:\n  ${incomplete.join("\n  ")}`);

  await mkdir(DIRECTORY, { recursive: true });
  const written = new Date().toISOString();
  const paths: string[] = [];
  for (const builder of builders) {
    const file: ChannelFixtureFile = {
      captured: written,
      minute,
      host: HOST,
      channels: Object.fromEntries(
        BUILT[builder].map(({ name }) => {
          const fixture = fixtures.get(name);
          assert(fixture !== undefined, `${name} has no fixture`);
          return [name, fixture];
        }),
      ),
    };
    const path = join(DIRECTORY, `${fileName(builder)}.json`);
    await writeFile(path, `${JSON.stringify(file, null, 2)}\n`);
    paths.push(path);
  }
  /* Laid out as the formatter would, so a tuple reads on one line and `bun run check` still passes. */
  execFileSync("bunx", ["oxfmt", ...paths], { stdio: "inherit" });
  for (const path of paths) console.log(`Wrote ${path}`);
}

/**
 * Picks the builders to capture.
 *
 * @param asked - The builders to keep, as named on `channels`; none means all.
 * @returns The builders, in the order `BUILT` lists them.
 * @throws A VeloError when a name is not a builder.
 */
function chosenBuilders(asked: readonly string[]): Builder[] {
  for (const builder of asked) {
    assert(
      isListed(BUILDERS, builder),
      `unknown builder "${builder}"; expected ${BUILDERS.join(", ")}`,
    );
  }
  return BUILDERS.filter((builder) => asked.length === 0 || asked.includes(builder));
}

/**
 * Follows the channels through the end of one minute and a little past it.
 *
 * @remarks
 * A channel's rollover is the first frame that opens the next minute, and its
 * last of the minute is whichever frame arrived just before.
 *
 * @param velo - The client to watch with.
 * @param names - The wire names to follow.
 * @returns The start of the minute that ended, and what arrived on each channel.
 * @throws A VeloError when the server refuses a channel, the connection
 * fails, or a frame has no `tt`.
 */
async function captureMinuteEnd(
  velo: Velo,
  names: readonly string[],
): Promise<{ minute: number; captured: ReadonlyMap<string, Captured> }> {
  const captured = new Map<string, Captured>(names.map((name) => [name, {}]));
  const problems: string[] = [];

  const started = Date.now();
  const current = Math.floor(started / MINUTE) * MINUTE;
  const minute = current + MINUTE - started < SHORTEST_CAPTURE ? current + MINUTE : current;
  const end = minute + MINUTE;
  const until = end + AFTER_MINUTE;

  console.log(`Following ${names.length} channels until ${clock(until)} UTC...`);
  const followed = names.map((name) =>
    channels.raw(name).on({
      data: (_payload, { frame }) => {
        const sofar = captured.get(name);
        assert(sofar !== undefined, `${name}: a frame that was not asked for`);
        if (sofar.rollover !== undefined) return;
        if (opensNextMinute(frame, minute)) sofar.rollover = frame;
        else sofar.lastOfMinute = frame;
      },
      error: ({ reason }) => problems.push(`${name}: ${reason}`),
    }),
  );
  const watcher = await velo.watch(channels.feed(followed), {
    reconnect: false,
    /* The emitter catches what a listener throws; a frame without a `tt` must still fail the run. */
    onListenerError: (error) => problems.push(String(error)),
    on: { error: (error) => problems.push(error.message) },
  });
  await sleep(until - Date.now());
  watcher.close();

  assert(problems.length === 0, () => problems.join("\n"));
  return { minute, captured };
}

/**
 * Whether a frame is the first of the minute after the one captured.
 *
 * @remarks
 * The server flags that frame `f: true`, once per channel per minute. Its
 * `tt` does not place it: a coin's channel stamps it anywhere from a
 * millisecond before the minute ends to a second after, and not in order.
 * Two channels never carry `f`, a product's dollar open interest and its
 * dollar funding spend, and their `tt` is all there is to go by.
 *
 * The rollover of the minute before can arrive seconds late, so a frame
 * stamped in the first half of the captured minute is never this one.
 *
 * @param frame - A frame from the server.
 * @param minute - The start of the minute being captured, in milliseconds.
 * @returns Whether the frame opens the next minute.
 * @throws A VeloError when the frame has no `tt`.
 */
function opensNextMinute(frame: ChannelFrame, minute: number): boolean {
  assert(typeof frame.tt === "number", `${frame.c}: a frame without a tt`);
  if (frame.tt < minute + MINUTE / 2) return false;
  return frame.f === undefined ? frame.tt >= minute + MINUTE : frame.f;
}

/**
 * Checks that a channel delivered both frames, the first of them inside the minute.
 *
 * @param name - The channel's wire name.
 * @param minute - The start of the minute captured, in milliseconds.
 * @param captured - What arrived on each channel.
 * @returns The fixture, or a line saying what is wrong with it.
 */
function completeFixture(
  name: string,
  minute: number,
  captured: ReadonlyMap<string, Captured>,
): ChannelFixture | string {
  const { lastOfMinute, rollover } = captured.get(name) ?? {};
  if (lastOfMinute === undefined) return `${name}: no frame before the rollover`;
  if (rollover === undefined) return `${name}: no rollover`;
  const { tt } = lastOfMinute;
  if (typeof tt !== "number" || tt < minute || tt >= minute + MINUTE) {
    return `${name}: the frame before the rollover is stamped outside the minute: ${tt}`;
  }
  return { lastOfMinute, rollover };
}

/**
 * Names a builder's fixture file after its source file.
 *
 * @param builder - The builder, as named on `channels`, such as `openInterest`.
 * @returns The file name without its extension, such as `open-interest`.
 */
function fileName(builder: Builder): string {
  return builder.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/**
 * Formats an instant as a UTC time of day.
 *
 * @param time - The instant, in milliseconds.
 * @returns The time, as `HH:MM:SS`.
 */
function clock(time: number): string {
  return new Date(time).toISOString().slice(11, 19);
}

/**
 * Waits.
 *
 * @param milliseconds - How long to wait.
 * @returns A promise that resolves after the wait.
 */
function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

await main();
