import { assert } from "../../../util/assert.ts";
import { lowerTimedScope, type TimedScope } from "../../common/builder/scope.ts";
import type { FuturesExchange } from "../../common/market/exchanges.ts";
import type { OrderbookParams, OrderbookResolution } from "./params.ts";

/** Selects the book a query targets: one exchange product or one Velo coin. */
export type OrderbookTarget =
  | { readonly exchange: FuturesExchange; readonly product: string; readonly coin?: never }
  | { readonly coin: string; readonly exchange?: never; readonly product?: never };

/**
 * The required query scope accepted by the orderbook terminal methods.
 *
 * Everything a levels query cannot run without lives here, so an incomplete
 * query is a compile-time error rather than a runtime one.
 */
export type OrderbookScope = OrderbookTarget & TimedScope<OrderbookResolution>;

/**
 * Lowers a full orderbook scope into raw params.
 *
 * A trailing duration is anchored to the current time when this function
 * runs, which is why the namespace defers lowering until a terminal method.
 *
 * @throws {@link VeloError} when the scope is malformed at runtime; the
 * {@link OrderbookScope} type rules this out for TypeScript callers.
 */
export function lowerOrderbookScope(scope: OrderbookScope): OrderbookParams {
  return {
    ...lowerOrderbookTarget(scope),
    ...lowerTimedScope(scope),
  };
}

/**
 * Lowers a target selection into its params counterpart.
 *
 * @throws {@link VeloError} when the target selects neither or both of a
 * product and a coin, which the {@link OrderbookTarget} type rules out for
 * TypeScript callers.
 */
function lowerOrderbookTarget(
  scope: OrderbookTarget,
): { readonly exchange: FuturesExchange; readonly product: string } | { readonly coin: string } {
  const { exchange, product, coin } = scope;
  if (coin !== undefined) {
    assert(
      exchange === undefined && product === undefined,
      "scope cannot select both a product and a coin",
    );
    return { coin };
  }
  assert(
    exchange !== undefined && product !== undefined,
    "scope must select an exchange and product, or a coin",
  );
  return { exchange, product };
}
