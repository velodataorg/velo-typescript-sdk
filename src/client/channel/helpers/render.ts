import { assert } from "../../../util/assert.ts";
import { isNonEmptyString } from "../../../util/string.ts";
import { validateChannelName } from "../name.ts";

/**
 * Channel strings: how a channel is spelled to the server.
 *
 * This file is the only place a name is put together:
 *
 *     name   := "realtime_" target suffix ("#Aggregated")?
 *     target := exchange ":" product | coin
 *
 * The suffix says what is published about the target, such as
 * `#open_interest#Coins`; price has none. It is written as the server's own
 * list has it, so a definition can be checked against that list by eye.
 * `#Aggregated` is no part of any definition's suffix. It is how following a
 * coin is spelled, as `<exchange>:<product>` is how following a product is:
 * the server ends every channel that spans exchanges with it, and no other.
 */

const REALTIME_PREFIX = "realtime_";
const SUFFIX_SEPARATOR = "#";
const AGGREGATED_SUFFIX = "#Aggregated";

/**
 * Renders the name of a single channel: one product on one exchange.
 *
 * @param product - The exchange identifier and its own symbol, as the
 * catalog returns them; no symbol is translated.
 * @param suffix - The definition's suffix, as the server lists it.
 * @returns The validated channel string.
 * @throws A VeloError when a part is empty, the suffix is not one, or the
 * result is not a valid channel name.
 */
export function renderSingleName(
  product: { readonly exchange: string; readonly product: string },
  suffix: string,
): string {
  assert(
    isNonEmptyString(product.exchange) && isNonEmptyString(product.product),
    "a single channel's name needs a non-empty exchange and product",
  );
  return render(`${product.exchange}:${product.product}`, suffix);
}

/**
 * Renders the name of an aggregated channel: one coin across exchanges.
 *
 * @param coin - The Velo coin symbol, as the catalog returns it. Symbols are
 * not limited to ASCII.
 * @param suffix - The definition's suffix, as the server lists it for the
 * single channel.
 * @returns The validated channel string, ending in the aggregated marker.
 * @throws A VeloError when the coin is empty, the suffix is not one, or the
 * result is not a valid channel name.
 */
export function renderAggregatedName(coin: string, suffix: string): string {
  assert(isNonEmptyString(coin), "an aggregated channel's name needs a non-empty coin");
  return render(coin, suffix, AGGREGATED_SUFFIX);
}

/**
 * Reads the exchange out of one key of an aggregated frame.
 *
 * @remarks
 * An aggregated frame holds one payload per exchange, each keyed
 * `realtime_<exchange>`.
 *
 * @param key - A key of the frame's payload.
 * @returns The exchange identifier, or the key itself when it has no prefix.
 */
export function entryExchange(key: string): string {
  return key.startsWith(REALTIME_PREFIX) ? key.slice(REALTIME_PREFIX.length) : key;
}

/**
 * Joins a target, a suffix, and a marker into a channel string.
 *
 * @param target - The target, already spelled.
 * @param suffix - The definition's suffix.
 * @param marker - What the kind of target adds after it, if anything.
 * @returns The validated channel string.
 * @throws A VeloError when the suffix is neither empty nor led by the
 * separator, or the result is not a valid channel name.
 */
function render(target: string, suffix: string, marker = ""): string {
  assert(
    typeof suffix === "string" && (suffix === "" || suffix.startsWith(SUFFIX_SEPARATOR)),
    () =>
      `a channel name suffix must be empty or start with ${SUFFIX_SEPARATOR} (got ${JSON.stringify(suffix)})`,
  );
  const name = REALTIME_PREFIX + target + suffix + marker;
  validateChannelName(name);
  return name;
}
