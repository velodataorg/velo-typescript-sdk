import type { Exchange } from "./exchanges.ts";

/**
 * What identifies one product: where it trades, the coin it tracks, and the
 * exchange's own symbol for it.
 *
 * The catalog returns products in this shape, every history row starts with
 * it, and a product-scoped channel is built from it, so a catalog product can
 * be handed to any of them as returned.
 *
 * @typeParam E - The exchanges the product may trade on.
 */
export interface Product<E extends string = Exchange> {
  readonly exchange: E;
  readonly coin: string;
  /* The exchange-native symbol, exactly as the server spells it. */
  readonly product: string;
}
