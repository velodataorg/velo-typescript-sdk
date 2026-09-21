import { assert } from "../../util/assert.ts";

/*
 * What holds of any channel name, whoever spelled it: a feed checks the names
 * it is given, and a watcher routes each to its socket. Spelling a name from
 * its words is done in `helpers/render.ts`.
 */

/** The socket endpoint that serves a channel. */
export type ChannelEndpoint = "realtime" | "ondemand";

const ONDEMAND_PREFIX = "ondemand_";

/* Control characters could alter the framing of a subscription command. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

/**
 * Checks that a value can be sent as a channel name.
 *
 * @param name - The candidate name.
 * @throws A VeloError when `name` is empty, padded, or carries control
 * characters.
 */
export function validateChannelName(name: unknown): asserts name is string {
  assert(
    typeof name === "string" &&
      name.length > 0 &&
      name === name.trim() &&
      !CONTROL_CHARACTERS.test(name),
    "channel names must be non-empty strings without surrounding whitespace or control characters",
  );
}

/**
 * Resolves which socket endpoint serves a channel.
 *
 * @remarks
 * The server encodes the endpoint in the name: on-demand channels carry an
 * `ondemand_` prefix and are served on a separate socket path.
 *
 * @param name - A validated channel name.
 * @returns The endpoint to subscribe on.
 */
export function channelEndpoint(name: string): ChannelEndpoint {
  return name.startsWith(ONDEMAND_PREFIX) ? "ondemand" : "realtime";
}
