import { openInterest } from "./open-interest.ts";
import { price } from "./price.ts";
import { raw } from "./raw.ts";

/**
 * Standalone channel construction, spelled like the history builders.
 *
 * A builder that takes a metric covers one kind of channel per metric.
 */
export const channel = Object.freeze({ raw, price, openInterest });
