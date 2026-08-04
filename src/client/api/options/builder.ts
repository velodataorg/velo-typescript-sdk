import {
  type BuilderMarket,
  type BuilderWindow,
  lowerBuilderScope,
  type MarketScope,
  snapshotBuilderMarket,
  snapshotBuilderWindow,
  type WindowScope,
} from "../../builder/scope.ts";
import type { ScopeBuilderStep, ScopedBuilder } from "../../builder/scoped.ts";
import { metricColumns, partColumns, splitParts } from "../../builder/selection.ts";
import type { OptionsColumn } from "../../market/columns.ts";
import { OPTIONS_EXCHANGES, type OptionsExchange } from "../../market/exchanges.ts";
import type { QueryRequest } from "../../query/plan.ts";
import { OptionsParams, type OptionsParams as OptionsParamsType } from "./params.ts";
import {
  OPTIONS_SELECTOR_COLUMNS,
  type OptionsDeltaColumn,
  type OptionsDeltaMetric,
  type OptionsDeltaPart,
  type OptionsDollarVolumeColumn,
  type OptionsDvolColumn,
  type OptionsDvolPart,
  type OptionsGammaColumn,
  type OptionsGammaMetric,
  type OptionsIndexPriceColumn,
  type OptionsIvColumn,
  type OptionsIvTenor,
  type OptionsNotionalColumn,
  type OptionsNotionalPart,
  type OptionsPremiumColumn,
  type OptionsPremiumPart,
  type OptionsSkewColumn,
  type OptionsSkewTenor,
  type OptionsVegaColumn,
  type OptionsVegaMetric,
  type OptionsVolumeColumn,
  type OptionsVolumePart,
} from "./selectors.ts";

export type { LastDuration } from "../../builder/time.ts";
export type {
  MarketScope,
  MarketRowsScope,
  RowsScope,
  TargetScope,
  TimeScope,
  WindowScope,
} from "../../builder/scope.ts";
/** Instruments and optional exchanges configured by an options builder's `for()` step. */
export type OptionsMarketScope = MarketScope<OptionsExchange>;
export type {
  OptionsDeltaMetric,
  OptionsDeltaPart,
  OptionsDvolPart,
  OptionsGammaMetric,
  OptionsIvTenor,
  OptionsNotionalPart,
  OptionsPremiumPart,
  OptionsSkewTenor,
  OptionsVegaMetric,
  OptionsVolumePart,
} from "./selectors.ts";

const {
  iv: IV_COLUMNS,
  skew: SKEW_COLUMNS,
  vega: VEGA_COLUMNS,
  delta: DELTA_COLUMNS,
  gamma: GAMMA_COLUMNS,
  volume: VOLUME_COLUMNS,
  dollarVolume: DOLLAR_VOLUME_COLUMN,
  premium: PREMIUM_COLUMNS,
  notional: NOTIONAL_COLUMNS,
  dvol: DVOL_COLUMNS,
  indexPrice: INDEX_PRICE_COLUMN,
} = OPTIONS_SELECTOR_COLUMNS;

interface State<C extends OptionsColumn> {
  readonly columns: readonly C[];
  readonly market?: BuilderMarket<OptionsExchange>;
  readonly window?: BuilderWindow;
}

/**
 * An immutable fluent options request builder.
 *
 * Each selector returns a new builder, so a partially configured chain can be
 * safely reused as the base for multiple queries.
 *
 * @typeParam C - Raw options columns selected by the chain.
 * @typeParam S - Scope-setting methods completed by the chain.
 */
export class OptionsBuilder<C extends OptionsColumn = never, S extends ScopeBuilderStep = never> {
  readonly #state: State<C>;

  constructor(state: State<C> = { columns: [] }) {
    this.#state = state;
  }

  /** Adds every implied-volatility tenor column. */
  iv(): OptionsBuilder<C | OptionsIvColumn, S>;
  /**
   * Adds the given implied-volatility tenor columns.
   *
   * @param tenors - Tenors to add; must not be empty.
   * @returns A new builder typed with the accumulated columns.
   */
  iv<T extends OptionsIvTenor>(tenors: readonly T[]): OptionsBuilder<C | OptionsIvColumn<T>, S>;
  iv<T extends OptionsIvTenor>(tenors?: readonly T[]): OptionsBuilder<C | OptionsIvColumn<T>, S> {
    const columns = partColumns("iv", IV_COLUMNS, tenors);
    return this.#withColumns(columns) as OptionsBuilder<C | OptionsIvColumn<T>, S>;
  }

  /** Adds every skew tenor column. */
  skew(): OptionsBuilder<C | OptionsSkewColumn, S>;
  /**
   * Adds the given skew tenor columns.
   *
   * @param tenors - Tenors to add; must not be empty.
   * @returns A new builder typed with the accumulated columns.
   */
  skew<T extends OptionsSkewTenor>(
    tenors: readonly T[],
  ): OptionsBuilder<C | OptionsSkewColumn<T>, S>;
  skew<T extends OptionsSkewTenor>(
    tenors?: readonly T[],
  ): OptionsBuilder<C | OptionsSkewColumn<T>, S> {
    const columns = partColumns("skew", SKEW_COLUMNS, tenors);
    return this.#withColumns(columns) as OptionsBuilder<C | OptionsSkewColumn<T>, S>;
  }

  /** Adds the dollar vega column. */
  vega(): OptionsBuilder<C | OptionsVegaColumn<"dollar">, S>;
  /**
   * Adds one vega column.
   *
   * @param options - Column options selecting the metric.
   */
  vega<M extends OptionsVegaMetric>(options: {
    readonly metric: M;
  }): OptionsBuilder<C | OptionsVegaColumn<M>, S>;
  vega<M extends OptionsVegaMetric>(options?: {
    readonly metric: M;
  }): OptionsBuilder<C | OptionsVegaColumn<M>, S> {
    return this.#withColumns([metricColumns("vega", VEGA_COLUMNS, options)]) as OptionsBuilder<
      C | OptionsVegaColumn<M>,
      S
    >;
  }

  /** Adds both dollar delta columns. */
  delta(): OptionsBuilder<C | OptionsDeltaColumn<"dollar">, S>;
  /**
   * Adds both delta columns for one metric.
   *
   * @param options - Column options selecting the metric.
   * @returns A new builder typed with the accumulated columns.
   */
  delta<M extends OptionsDeltaMetric>(options: {
    readonly metric: M;
  }): OptionsBuilder<C | OptionsDeltaColumn<M>, S>;
  /**
   * Adds the given dollar delta columns.
   *
   * @param parts - Option sides to add; must not be empty.
   * @returns A new builder typed with the accumulated columns.
   */
  delta<P extends OptionsDeltaPart>(
    parts: readonly P[],
  ): OptionsBuilder<C | OptionsDeltaColumn<"dollar", P>, S>;
  /**
   * Adds the given delta columns for one metric.
   *
   * @param parts - Option sides to add; must not be empty.
   * @param options - Column options selecting the metric.
   * @returns A new builder typed with the accumulated columns.
   */
  delta<P extends OptionsDeltaPart, M extends OptionsDeltaMetric>(
    parts: readonly P[],
    options: { readonly metric: M },
  ): OptionsBuilder<C | OptionsDeltaColumn<M, P>, S>;
  delta<P extends OptionsDeltaPart, M extends OptionsDeltaMetric>(
    partsOrOptions?: readonly P[] | { readonly metric: M },
    metricOptions?: { readonly metric: M },
  ): OptionsBuilder<C | OptionsDeltaColumn<M, P>, S> {
    const { parts, options } = splitParts("delta", partsOrOptions, metricOptions);
    const columns = metricColumns("delta", DELTA_COLUMNS, options);
    return this.#withColumns(partColumns("delta", columns, parts)) as OptionsBuilder<
      C | OptionsDeltaColumn<M, P>,
      S
    >;
  }

  /** Adds the dollar gamma column. */
  gamma(): OptionsBuilder<C | OptionsGammaColumn<"dollar">, S>;
  /**
   * Adds one gamma column.
   *
   * @param options - Column options selecting the metric.
   */
  gamma<M extends OptionsGammaMetric>(options: {
    readonly metric: M;
  }): OptionsBuilder<C | OptionsGammaColumn<M>, S>;
  gamma<M extends OptionsGammaMetric>(options?: {
    readonly metric: M;
  }): OptionsBuilder<C | OptionsGammaColumn<M>, S> {
    return this.#withColumns([metricColumns("gamma", GAMMA_COLUMNS, options)]) as OptionsBuilder<
      C | OptionsGammaColumn<M>,
      S
    >;
  }

  /** Adds both call/put volume columns. */
  volume(): OptionsBuilder<C | OptionsVolumeColumn, S>;
  /**
   * Adds the given call/put volume columns.
   *
   * @param parts - Option sides to add; must not be empty.
   * @returns A new builder typed with the accumulated columns.
   */
  volume<P extends OptionsVolumePart>(
    parts: readonly P[],
  ): OptionsBuilder<C | OptionsVolumeColumn<P>, S>;
  volume<P extends OptionsVolumePart>(
    parts?: readonly P[],
  ): OptionsBuilder<C | OptionsVolumeColumn<P>, S> {
    const columns = partColumns("volume", VOLUME_COLUMNS, parts);
    return this.#withColumns(columns) as OptionsBuilder<C | OptionsVolumeColumn<P>, S>;
  }

  /** Adds total dollar volume. */
  dollarVolume(): OptionsBuilder<C | OptionsDollarVolumeColumn, S> {
    return this.#withColumns([DOLLAR_VOLUME_COLUMN]);
  }

  /** Adds both call/put premium columns. */
  premium(): OptionsBuilder<C | OptionsPremiumColumn, S>;
  /**
   * Adds the given call/put premium columns.
   *
   * @param parts - Option sides to add; must not be empty.
   * @returns A new builder typed with the accumulated columns.
   */
  premium<P extends OptionsPremiumPart>(
    parts: readonly P[],
  ): OptionsBuilder<C | OptionsPremiumColumn<P>, S>;
  premium<P extends OptionsPremiumPart>(
    parts?: readonly P[],
  ): OptionsBuilder<C | OptionsPremiumColumn<P>, S> {
    const columns = partColumns("premium", PREMIUM_COLUMNS, parts);
    return this.#withColumns(columns) as OptionsBuilder<C | OptionsPremiumColumn<P>, S>;
  }

  /** Adds both call/put notional columns. */
  notional(): OptionsBuilder<C | OptionsNotionalColumn, S>;
  /**
   * Adds the given call/put notional columns.
   *
   * @param parts - Option sides to add; must not be empty.
   * @returns A new builder typed with the accumulated columns.
   */
  notional<P extends OptionsNotionalPart>(
    parts: readonly P[],
  ): OptionsBuilder<C | OptionsNotionalColumn<P>, S>;
  notional<P extends OptionsNotionalPart>(
    parts?: readonly P[],
  ): OptionsBuilder<C | OptionsNotionalColumn<P>, S> {
    const columns = partColumns("notional", NOTIONAL_COLUMNS, parts);
    return this.#withColumns(columns) as OptionsBuilder<C | OptionsNotionalColumn<P>, S>;
  }

  /** Adds all four DVOL OHLC columns. */
  dvol(): OptionsBuilder<C | OptionsDvolColumn, S>;
  /**
   * Adds the given DVOL OHLC columns.
   *
   * @param parts - Price components to add; must not be empty.
   * @returns A new builder typed with the accumulated columns.
   */
  dvol<P extends OptionsDvolPart>(parts: readonly P[]): OptionsBuilder<C | OptionsDvolColumn<P>, S>;
  dvol<P extends OptionsDvolPart>(
    parts?: readonly P[],
  ): OptionsBuilder<C | OptionsDvolColumn<P>, S> {
    const columns = partColumns("dvol", DVOL_COLUMNS, parts);
    return this.#withColumns(columns) as OptionsBuilder<C | OptionsDvolColumn<P>, S>;
  }

  /** Adds the underlying index-price column. */
  indexPrice(): OptionsBuilder<C | OptionsIndexPriceColumn, S> {
    return this.#withColumns([INDEX_PRICE_COLUMN]);
  }

  /** Replaces the instruments and exchanges selected by the chain. */
  for(scope: OptionsMarketScope): OptionsBuilder<C, S | "for"> {
    return new OptionsBuilder<C, S | "for">({
      ...this.#state,
      market: snapshotBuilderMarket(scope, OPTIONS_EXCHANGES),
    });
  }

  /** Replaces the time window and resolution selected by the chain. */
  over(scope: WindowScope): OptionsBuilder<C, S | "over"> {
    return new OptionsBuilder<C, S | "over">({
      ...this.#state,
      window: snapshotBuilderWindow(scope),
    });
  }

  /** Lowers and validates the chain into fresh raw options parameters. */
  params(this: ScopedBuilder<OptionsBuilder<C, S>, S>): OptionsParams<C> {
    return this.#params();
  }

  /**
   * Lowers the chain into an immutable transport-independent request.
   *
   * A trailing duration configured by `over()` is fixed when this method is called.
   */
  build(
    this: ScopedBuilder<OptionsBuilder<C, S>, S>,
    ...ready: ScopeBuilderStep extends S ? [] : [never]
  ): QueryRequest<"options.rows", OptionsParamsType<C>> {
    void ready;
    return this.#build();
  }

  #withColumns<Added extends OptionsColumn>(
    columns: readonly Added[],
  ): OptionsBuilder<C | Added, S> {
    const accumulated: (C | Added)[] = [...this.#state.columns];
    const seen = new Set<C | Added>(accumulated);
    for (const column of columns) {
      if (seen.has(column)) continue;
      seen.add(column);
      accumulated.push(column);
    }
    return new OptionsBuilder<C | Added, S>({
      ...this.#state,
      columns: accumulated,
    });
  }

  #params(): OptionsParams<C> {
    const lowered: OptionsParams<C> = {
      columns: [...this.#state.columns],
      ...lowerBuilderScope(this.#state.market, this.#state.window),
    };
    return OptionsParams.parse(lowered);
  }

  #build(): QueryRequest<"options.rows", OptionsParamsType<C>> {
    const params = freezeOptionsRowsParams(this.#params());
    return Object.freeze({ kind: "options.rows", params });
  }
}

function freezeOptionsRowsParams<C extends OptionsColumn>(
  params: OptionsParamsType<C>,
): OptionsParamsType<C> {
  Object.freeze(params.exchanges);
  Object.freeze(params.columns);
  if (params.products !== undefined) Object.freeze(params.products);
  if (params.coins !== undefined) Object.freeze(params.coins);
  return Object.freeze(params);
}
