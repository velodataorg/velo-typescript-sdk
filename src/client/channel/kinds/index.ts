import { price } from "./price.ts";
import { raw } from "./raw.ts";

/** Standalone channel construction: one builder per kind of channel a feed can carry. */
export const channel = Object.freeze({ raw, price });
