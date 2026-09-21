import { isListed } from "../../util/array.ts";
import { assert } from "../../util/assert.ts";
import { isRecord } from "../../util/object.ts";
import type { Channel, ChannelListeners, CustomChannel } from "./channel.ts";

/*
 * The listeners of every channel built here, kept beside the channel and not
 * on it. A channel's own fields stay the three that say what it is, and
 * nobody can hand a feed listeners that disagree with a channel's decoder:
 * `on()` is the only way in, and it is typed by the channel.
 */
const LISTENERS = new WeakMap<object, ChannelListeners>();

const LISTENER_NAMES = ["data", "error"] as const;

/**
 * Puts a channel together: its three fields, frozen, with `on()`.
 *
 * @param definition - The kind, the wire name, and the decoder, already checked.
 * @param listeners - The listeners the channel carries.
 * @returns The frozen channel.
 */
export function createChannel<Kind extends string, Data>(
  definition: CustomChannel<Kind, Data>,
  listeners: ChannelListeners<Kind, Data> = {},
): Channel<Kind, Data> {
  const { kind, name, decode } = definition;
  const channel: Channel<Kind, Data> = Object.freeze({
    kind,
    name,
    decode,
    on: (added: ChannelListeners<Kind, Data>) =>
      createChannel(definition, addListeners(listeners, added, name)),
  });
  LISTENERS.set(channel, Object.freeze({ ...listeners }));
  return channel;
}

/**
 * Whether a value is a channel built on the `channels` namespace.
 *
 * @param value - The candidate.
 * @returns Whether `createChannel` built it.
 */
export function isChannel(value: unknown): value is Channel {
  return typeof value === "object" && value !== null && LISTENERS.has(value);
}

/**
 * Reads the listeners a channel carries.
 *
 * @param channel - A channel built on the `channels` namespace.
 * @returns Its listeners; empty when `on()` was never called.
 * @throws A VeloError when the channel was not built here.
 */
export function listenersOf(channel: Channel): ChannelListeners {
  const listeners = LISTENERS.get(channel);
  assert(listeners !== undefined, `${channel.name} was not built on the channels namespace`);
  return listeners;
}

/**
 * Checks the listeners a caller passed to `on()` and adds them to a channel's.
 *
 * @param listeners - The listeners the channel already carries.
 * @param added - What the caller passed.
 * @param name - The channel's wire name, for the context of a failure.
 * @returns Both, as one set of listeners.
 * @throws A VeloError when `added` is not an object of functions, names a
 * listener a channel does not have, or names one already attached.
 */
function addListeners<Kind extends string, Data>(
  listeners: ChannelListeners<Kind, Data>,
  added: ChannelListeners<Kind, Data>,
  name: string,
): ChannelListeners<Kind, Data> {
  assert(isRecord(added), "on() takes an object of listeners, such as { data, error }");
  for (const [listener, value] of Object.entries(added)) {
    assert(
      isListed(LISTENER_NAMES, listener),
      () =>
        `on() received an unknown listener ${JSON.stringify(listener)}; expected ${LISTENER_NAMES.join(", ")}`,
    );
    assert(typeof value === "function", `on() takes a function for ${listener}`);
    assert(listeners[listener] === undefined, `${name} already has a ${listener} listener`);
  }
  return { ...listeners, ...added };
}
