import { assert } from "../../util/assert.ts";
import type { Resolution } from "../time/resolution.ts";
import { durationMilliseconds, type LastDuration, timestamp } from "./time.ts";

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

/** The time window and bucket size configured by a builder's `over()` step. */
export type WindowScope<R extends Resolution = Resolution> = TimedScope<R>;

/** The instruments and optional exchanges configured by a builder's `for()` step. */
export type MarketScope<E extends string> = TargetScope & {
  /** Defaults to every exchange supported by the market when omitted. */
  readonly exchanges?: readonly E[];
};

/**
 * A complete target and time scope used by builders that accept one object.
 *
 * Standard futures, spot, and options builders expose these fields separately
 * through `for()` and `over()`; other builders may still accept this shape.
 */
export type RowsScope = TargetScope & WindowScope;

/** A rows scope with an optional selection from one market's exchanges. */
export type MarketRowsScope<E extends string> = MarketScope<E> & WindowScope;

/** A snapshotted market selection stored by an immutable builder. */
export type BuilderMarket<E extends string> = (
  | { readonly products: readonly string[] }
  | { readonly coins: readonly string[] }
) & { readonly exchanges: readonly E[] };

/** A snapshotted time window stored by an immutable builder. */
export type BuilderWindow<R extends Resolution = Resolution> =
  | {
      readonly kind: "between";
      readonly begin: number;
      readonly end: number;
      readonly resolution: R;
    }
  | {
      readonly kind: "last";
      readonly milliseconds: number;
      readonly resolution: R;
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

/** Snapshots the target and exchanges supplied to a builder's `for()` step. */
export function snapshotBuilderMarket<E extends string>(
  scope: MarketScope<E>,
  defaultExchanges: readonly E[],
): BuilderMarket<E> {
  return {
    exchanges: [...(scope.exchanges ?? defaultExchanges)],
    ...lowerTargetScope(scope),
  };
}

/**
 * Snapshots a builder's `over()` input without anchoring a trailing duration
 * to the clock. Explicit Date bounds become timestamps immediately.
 */
export function snapshotBuilderWindow<R extends Resolution>(
  scope: WindowScope<R>,
): BuilderWindow<R> {
  assert(scope.resolution !== undefined, "scope must set a resolution");
  const { between, last } = scope;
  if (between !== undefined) {
    assert(last === undefined, "scope cannot set both between and last");
    return {
      kind: "between",
      begin: timestamp(between[0]),
      end: timestamp(between[1]),
      resolution: scope.resolution,
    };
  }
  assert(last !== undefined, "scope must set between or last");
  return {
    kind: "last",
    milliseconds: durationMilliseconds(last),
    resolution: scope.resolution,
  };
}

/** Lowers snapshotted builder state, anchoring a trailing window to now. */
export function lowerBuilderScope<E extends string, R extends Resolution>(
  market: BuilderMarket<E> | undefined,
  window: BuilderWindow<R> | undefined,
): BuilderMarket<E> & { readonly begin: number; readonly end: number; readonly resolution: R } {
  assert(market !== undefined, "for() must be called before a terminal method");

  const target =
    "products" in market ? { products: [...market.products] } : { coins: [...market.coins] };

  return {
    exchanges: [...market.exchanges],
    ...target,
    ...lowerBuilderWindow(window),
  };
}

/** Lowers a snapshotted builder window, anchoring a trailing duration to now. */
export function lowerBuilderWindow<R extends Resolution>(
  window: BuilderWindow<R> | undefined,
): { readonly begin: number; readonly end: number; readonly resolution: R } {
  assert(window !== undefined, "over() must be called before a terminal method");
  const range =
    window.kind === "between"
      ? { begin: window.begin, end: window.end }
      : (() => {
          const end = Date.now();
          return { begin: end - window.milliseconds, end };
        })();
  return { ...range, resolution: window.resolution };
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
