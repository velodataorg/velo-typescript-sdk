import { assert } from "../../../util/assert.js";
import type { Resolution } from "../time/resolution.js";
import { durationMilliseconds, type LastDuration, timestamp } from "./time.js";

/** Selects the instruments a query targets: exchange products or Velo coins. */
export type TargetScope =
  | { readonly products: readonly string[]; readonly coins?: never }
  | { readonly coins: readonly string[]; readonly products?: never };

/** Selects the half-open time range: an explicit window or a trailing duration. */
export type TimeScope =
  | { readonly between: readonly [number | Date, number | Date]; readonly last?: never }
  | { readonly last: LastDuration; readonly between?: never };

/** The time range and bucket size shared by every resolution-carrying scope. */
export type TimedScope<R extends Resolution = Resolution> = TimeScope & {
  readonly resolution: R;
};

/**
 * The required query scope accepted by a builder's terminal methods.
 *
 * Everything a `/rows` query cannot run without lives here, so an incomplete
 * query is a compile-time error rather than a runtime one.
 */
export type RowsScope = TargetScope & TimedScope;

/** A rows scope with an optional selection from one market's exchanges. */
export type MarketRowsScope<E extends string> = RowsScope & {
  /** Defaults to every exchange supported by the market when omitted. */
  readonly exchanges?: readonly E[];
};

/**
 * Lowers a target selection into its params counterpart.
 *
 * @throws {@link VeloError} when neither or both of products and coins are
 * given, which the {@link TargetScope} type rules out for TypeScript callers.
 */
export function lowerTargetScope(
  scope: TargetScope,
): { readonly products: readonly string[] } | { readonly coins: readonly string[] } {
  const { products, coins } = scope;
  if (products !== undefined) {
    assert(coins === undefined, "scope cannot select both products and coins");
    return { products: [...products] };
  }
  assert(coins !== undefined, "scope must select products or coins");
  return { coins: [...coins] };
}

/**
 * Lowers a time selection into begin and end timestamps.
 *
 * A trailing duration is anchored to the current time when this function
 * runs, which is why builders defer lowering until a terminal method.
 *
 * @throws {@link VeloError} when neither or both of between and last are
 * given, which the {@link TimeScope} type rules out for TypeScript callers.
 */
export function lowerTimeScope(scope: TimeScope): {
  readonly begin: number;
  readonly end: number;
} {
  const { between, last } = scope;
  if (between !== undefined) {
    assert(last === undefined, "scope cannot set both between and last");
    return { begin: timestamp(between[0]), end: timestamp(between[1]) };
  }
  assert(last !== undefined, "scope must set between or last");
  const end = Date.now();
  return { begin: end - durationMilliseconds(last), end };
}

/**
 * Lowers a timed selection into begin, end, and resolution.
 *
 * A trailing duration is anchored to the current time when this function
 * runs, which is why builders defer lowering until a terminal method.
 *
 * @throws {@link VeloError} when the resolution is missing at runtime, which
 * the {@link TimedScope} type rules out for TypeScript callers.
 */
export function lowerTimedScope<R extends Resolution>(
  scope: TimedScope<R>,
): {
  readonly begin: number;
  readonly end: number;
  readonly resolution: R;
} {
  assert(scope.resolution !== undefined, "scope must set a resolution");
  return { ...lowerTimeScope(scope), resolution: scope.resolution };
}

/**
 * Lowers a full rows scope into its params fields.
 *
 * @throws {@link VeloError} when the scope is malformed at runtime; the
 * {@link RowsScope} type rules this out for TypeScript callers.
 */
export function lowerRowsScope(scope: RowsScope): (
  | { readonly products: readonly string[] }
  | { readonly coins: readonly string[] }
) & {
  readonly begin: number;
  readonly end: number;
  readonly resolution: Resolution;
} {
  return {
    ...lowerTargetScope(scope),
    ...lowerTimedScope(scope),
  };
}

/**
 * Lowers a market rows scope and supplies the market's default exchanges.
 *
 * Explicit exchange arrays are copied when the scope is lowered. Supported,
 * non-empty, unique exchanges are validated by the market params schema.
 */
export function lowerMarketRowsScope<E extends string>(
  scope: MarketRowsScope<E>,
  defaultExchanges: readonly E[],
): ReturnType<typeof lowerRowsScope> & { readonly exchanges: readonly E[] } {
  return {
    exchanges: [...(scope.exchanges ?? defaultExchanges)],
    ...lowerRowsScope(scope),
  };
}
