import { z } from "zod";

import { NEWS_WEBSOCKET_PATH } from "../../../constants/endpoints.ts";
import { VeloError } from "../../../errors.ts";
import { newsStorySchema } from "./validation.ts";
import type { NewsStory } from "./validation.ts";

const MessageObjectSchema = z.record(z.string(), z.unknown());
const HeartbeatSchema = z.strictObject({ heartbeat: z.literal(true) });
const DeleteSchema = z.strictObject({
  id: z.int(),
  deleted: z.literal(true),
});
const EditSchema = newsStorySchema.extend({
  edit: z.literal(true),
});

export { frameText } from "../../../transport/frame.ts";

export type DecodedNewsMessage =
  | { readonly type: "heartbeat" }
  | { readonly type: "story"; readonly story: NewsStory }
  | { readonly type: "edit"; readonly story: NewsStory }
  | { readonly type: "delete"; readonly id: number };

/**
 * Decodes one live News frame into its typed message.
 *
 * @remarks
 * Frames are disambiguated by their marker field — `heartbeat`, `deleted`,
 * or `edit` — and validated strictly; a frame carrying conflicting markers
 * or an unknown shape is rejected rather than guessed at. A frame without
 * any marker must be a story.
 *
 * @param text - The frame payload as text.
 * @returns The decoded message.
 * @throws A VeloError when `text` is not valid JSON or matches no known
 * message shape.
 */
export function decodeNewsMessage(text: string): DecodedNewsMessage {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (cause) {
    throw new VeloError(`unexpected ${NEWS_WEBSOCKET_PATH} message: invalid JSON`, { cause });
  }

  const object = MessageObjectSchema.safeParse(value);
  if (!object.success) throw unexpectedMessage(object.error);

  const markerNames = (["heartbeat", "deleted", "edit"] as const).filter((name) =>
    Object.hasOwn(object.data, name),
  );
  if (markerNames.length > 1) {
    throw unexpectedMessage(
      new z.ZodError([
        {
          code: "custom",
          path: [],
          message: `conflicting event markers: ${markerNames.join(", ")}`,
        },
      ]),
    );
  }

  const marker = markerNames[0];
  if (marker === "heartbeat") {
    const result = HeartbeatSchema.safeParse(value);
    if (!result.success) throw unexpectedMessage(result.error);
    return { type: "heartbeat" };
  }
  if (marker === "deleted") {
    const result = DeleteSchema.safeParse(value);
    if (!result.success) throw unexpectedMessage(result.error);
    return { type: "delete", id: result.data.id };
  }
  if (marker === "edit") {
    const result = EditSchema.safeParse(value);
    if (!result.success) throw unexpectedMessage(result.error);
    return { type: "edit", story: newsStorySchema.parse(result.data) };
  }

  const result = newsStorySchema.safeParse(value);
  if (!result.success) throw unexpectedMessage(result.error);
  return { type: "story", story: result.data };
}

/**
 * Builds the validation failure for a frame that matches no message shape.
 *
 * @param error - The schema error describing the mismatch.
 * @returns A VeloError carrying the prettified schema error.
 */
function unexpectedMessage(error: z.ZodError): VeloError {
  return new VeloError(`unexpected ${NEWS_WEBSOCKET_PATH} message:\n${z.prettifyError(error)}`, {
    cause: error,
  });
}
