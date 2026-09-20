import { assert } from "../../../util/assert.ts";
import { isNonEmptyString } from "../../../util/string.ts";
import { validateChannelName } from "../name.ts";

/**
 * Channel strings: how a channel is spelled to the server.
 *
 * A name is made of words, and this file is the only place words become a
 * string:
 *
 *     name   := "realtime_" target ("#" word)* ("#Aggregated")?
 *     target := exchange ":" product | coin
 *
 * The words select what is published about the target, such as
 * `open_interest` then `Coins`; price has none. `#Aggregated` is not a word
 * of any indicator. It is how following a coin is spelled, as
 * `<exchange>:<product>` is how following a product is: the server ends every
 * channel that spans exchanges with it, and no other.
 */

const REALTIME_PREFIX = "realtime_";
const WORD_SEPARATOR = "#";
const AGGREGATED = "Aggregated";

/**
 * Renders the name of a single channel: one product on one exchange.
 *
 * @param product - The exchange identifier and its own symbol, as the
 * catalog returns them; no symbol is translated.
 * @param words - The indicator's words, in order.
 * @returns The validated channel string.
 * @throws A VeloError when a part is empty, a word contains the separator,
 * or the result is not a valid channel name.
 */
export function renderSingleName(
  product: { readonly exchange: string; readonly product: string },
  words: readonly string[],
): string {
  assert(
    isNonEmptyString(product.exchange) && isNonEmptyString(product.product),
    "a single channel's name needs a non-empty exchange and product",
  );
  return render(`${product.exchange}:${product.product}`, words);
}

/**
 * Renders the name of an aggregated channel: one coin across exchanges.
 *
 * @param coin - The Velo coin symbol, as the catalog returns it. Symbols are
 * not limited to ASCII.
 * @param words - The indicator's words, in order.
 * @returns The validated channel string, ending in the aggregated marker.
 * @throws A VeloError when a part is empty, a word contains the separator,
 * or the result is not a valid channel name.
 */
export function renderAggregatedName(coin: string, words: readonly string[]): string {
  assert(isNonEmptyString(coin), "an aggregated channel's name needs a non-empty coin");
  return render(coin, [...words, AGGREGATED]);
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
 * Joins a target and its words into a channel string.
 *
 * @param target - The target, already spelled.
 * @param words - Every word that follows it.
 * @returns The validated channel string.
 * @throws A VeloError when a word is unusable or the result is not a valid
 * channel name.
 */
function render(target: string, words: readonly string[]): string {
  for (const word of words) {
    assert(
      isNonEmptyString(word) && !word.includes(WORD_SEPARATOR),
      () =>
        `a channel name word must be non-empty and free of ${WORD_SEPARATOR} (got ${JSON.stringify(word)})`,
    );
  }
  const name = [REALTIME_PREFIX + target, ...words].join(WORD_SEPARATOR);
  validateChannelName(name);
  return name;
}
