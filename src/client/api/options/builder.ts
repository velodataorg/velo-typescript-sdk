import type { HttpRequestOptions } from "../../../transport/http.js";
import { lowerRowsScope, type RowsScope } from "../../common/builder/scope.js";
import { metricColumns, partColumns, splitParts } from "../../common/builder/selection.js";
import type { Data } from "../../common/data/data.js";
import type { OptionsColumn } from "../../common/market/columns.js";
import { OPTIONS_EXCHANGES, type OptionsExchange } from "../../common/market/exchanges.js";
import type { Query } from "../../common/query.js";
import { OptionsParams, type OptionsRow } from "./params.js";
import { OptionsQuery } from "./query.js";
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
} from "./selectors.js";

export type { LastDuration } from "../../common/builder/time.js";
export type { RowsScope, TargetScope, TimeScope } from "../../common/builder/scope.js";
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
} from "./selectors.js";

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
  readonly exchanges?: readonly OptionsExchange[];
}

/**
 * An immutable fluent options query under construction.
 *
 * Each selector returns a new builder, so a partially configured chain can be
 * safely reused as the base for multiple queries.
 *
 * @typeParam C - Raw options columns selected by the chain.
 */
export class OptionsBuilder<C extends OptionsColumn = never> {
  readonly #query: OptionsQuery;
  readonly #state: State<C>;

  constructor(query: OptionsQuery, state: State<C> = { columns: [] }) {
    this.#query = query;
    this.#state = state;
  }

  /** Adds every implied-volatility tenor column. */
  iv(): OptionsBuilder<C | OptionsIvColumn>;
  /**
   * Adds the given implied-volatility tenor columns.
   *
   * @param tenors - Tenors to add; must not be empty.
   * @returns A new builder typed with the accumulated columns.
   */
  iv<T extends OptionsIvTenor>(tenors: readonly T[]): OptionsBuilder<C | OptionsIvColumn<T>>;
  iv<T extends OptionsIvTenor>(tenors?: readonly T[]): OptionsBuilder<C | OptionsIvColumn<T>> {
    const columns = partColumns("iv", IV_COLUMNS, tenors);
    return this.#withColumns(columns) as OptionsBuilder<C | OptionsIvColumn<T>>;
  }

  /** Adds every skew tenor column. */
  skew(): OptionsBuilder<C | OptionsSkewColumn>;
  /**
   * Adds the given skew tenor columns.
   *
   * @param tenors - Tenors to add; must not be empty.
   * @returns A new builder typed with the accumulated columns.
   */
  skew<T extends OptionsSkewTenor>(tenors: readonly T[]): OptionsBuilder<C | OptionsSkewColumn<T>>;
  skew<T extends OptionsSkewTenor>(
    tenors?: readonly T[],
  ): OptionsBuilder<C | OptionsSkewColumn<T>> {
    const columns = partColumns("skew", SKEW_COLUMNS, tenors);
    return this.#withColumns(columns) as OptionsBuilder<C | OptionsSkewColumn<T>>;
  }

  /** Adds the dollar vega column. */
  vega(): OptionsBuilder<C | OptionsVegaColumn<"dollar">>;
  /**
   * Adds one vega column.
   *
   * @param options - Column options selecting the metric.
   */
  vega<M extends OptionsVegaMetric>(options: {
    readonly metric: M;
  }): OptionsBuilder<C | OptionsVegaColumn<M>>;
  vega<M extends OptionsVegaMetric>(options?: {
    readonly metric: M;
  }): OptionsBuilder<C | OptionsVegaColumn<M>> {
    return this.#withColumns([metricColumns("vega", VEGA_COLUMNS, options)]) as OptionsBuilder<
      C | OptionsVegaColumn<M>
    >;
  }

  /** Adds both dollar delta columns. */
  delta(): OptionsBuilder<C | OptionsDeltaColumn<"dollar">>;
  /**
   * Adds both delta columns for one metric.
   *
   * @param options - Column options selecting the metric.
   * @returns A new builder typed with the accumulated columns.
   */
  delta<M extends OptionsDeltaMetric>(options: {
    readonly metric: M;
  }): OptionsBuilder<C | OptionsDeltaColumn<M>>;
  /**
   * Adds the given dollar delta columns.
   *
   * @param parts - Option sides to add; must not be empty.
   * @returns A new builder typed with the accumulated columns.
   */
  delta<P extends OptionsDeltaPart>(
    parts: readonly P[],
  ): OptionsBuilder<C | OptionsDeltaColumn<"dollar", P>>;
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
  ): OptionsBuilder<C | OptionsDeltaColumn<M, P>>;
  delta<P extends OptionsDeltaPart, M extends OptionsDeltaMetric>(
    partsOrOptions?: readonly P[] | { readonly metric: M },
    metricOptions?: { readonly metric: M },
  ): OptionsBuilder<C | OptionsDeltaColumn<M, P>> {
    const { parts, options } = splitParts("delta", partsOrOptions, metricOptions);
    const columns = metricColumns("delta", DELTA_COLUMNS, options);
    return this.#withColumns(partColumns("delta", columns, parts)) as OptionsBuilder<
      C | OptionsDeltaColumn<M, P>
    >;
  }

  /** Adds the dollar gamma column. */
  gamma(): OptionsBuilder<C | OptionsGammaColumn<"dollar">>;
  /**
   * Adds one gamma column.
   *
   * @param options - Column options selecting the metric.
   */
  gamma<M extends OptionsGammaMetric>(options: {
    readonly metric: M;
  }): OptionsBuilder<C | OptionsGammaColumn<M>>;
  gamma<M extends OptionsGammaMetric>(options?: {
    readonly metric: M;
  }): OptionsBuilder<C | OptionsGammaColumn<M>> {
    return this.#withColumns([metricColumns("gamma", GAMMA_COLUMNS, options)]) as OptionsBuilder<
      C | OptionsGammaColumn<M>
    >;
  }

  /** Adds both call/put volume columns. */
  volume(): OptionsBuilder<C | OptionsVolumeColumn>;
  /**
   * Adds the given call/put volume columns.
   *
   * @param parts - Option sides to add; must not be empty.
   * @returns A new builder typed with the accumulated columns.
   */
  volume<P extends OptionsVolumePart>(
    parts: readonly P[],
  ): OptionsBuilder<C | OptionsVolumeColumn<P>>;
  volume<P extends OptionsVolumePart>(
    parts?: readonly P[],
  ): OptionsBuilder<C | OptionsVolumeColumn<P>> {
    const columns = partColumns("volume", VOLUME_COLUMNS, parts);
    return this.#withColumns(columns) as OptionsBuilder<C | OptionsVolumeColumn<P>>;
  }

  /** Adds total dollar volume. */
  dollarVolume(): OptionsBuilder<C | OptionsDollarVolumeColumn> {
    return this.#withColumns([DOLLAR_VOLUME_COLUMN]);
  }

  /** Adds both call/put premium columns. */
  premium(): OptionsBuilder<C | OptionsPremiumColumn>;
  /**
   * Adds the given call/put premium columns.
   *
   * @param parts - Option sides to add; must not be empty.
   * @returns A new builder typed with the accumulated columns.
   */
  premium<P extends OptionsPremiumPart>(
    parts: readonly P[],
  ): OptionsBuilder<C | OptionsPremiumColumn<P>>;
  premium<P extends OptionsPremiumPart>(
    parts?: readonly P[],
  ): OptionsBuilder<C | OptionsPremiumColumn<P>> {
    const columns = partColumns("premium", PREMIUM_COLUMNS, parts);
    return this.#withColumns(columns) as OptionsBuilder<C | OptionsPremiumColumn<P>>;
  }

  /** Adds both call/put notional columns. */
  notional(): OptionsBuilder<C | OptionsNotionalColumn>;
  /**
   * Adds the given call/put notional columns.
   *
   * @param parts - Option sides to add; must not be empty.
   * @returns A new builder typed with the accumulated columns.
   */
  notional<P extends OptionsNotionalPart>(
    parts: readonly P[],
  ): OptionsBuilder<C | OptionsNotionalColumn<P>>;
  notional<P extends OptionsNotionalPart>(
    parts?: readonly P[],
  ): OptionsBuilder<C | OptionsNotionalColumn<P>> {
    const columns = partColumns("notional", NOTIONAL_COLUMNS, parts);
    return this.#withColumns(columns) as OptionsBuilder<C | OptionsNotionalColumn<P>>;
  }

  /** Adds all four DVOL OHLC columns. */
  dvol(): OptionsBuilder<C | OptionsDvolColumn>;
  /**
   * Adds the given DVOL OHLC columns.
   *
   * @param parts - Price components to add; must not be empty.
   * @returns A new builder typed with the accumulated columns.
   */
  dvol<P extends OptionsDvolPart>(parts: readonly P[]): OptionsBuilder<C | OptionsDvolColumn<P>>;
  dvol<P extends OptionsDvolPart>(parts?: readonly P[]): OptionsBuilder<C | OptionsDvolColumn<P>> {
    const columns = partColumns("dvol", DVOL_COLUMNS, parts);
    return this.#withColumns(columns) as OptionsBuilder<C | OptionsDvolColumn<P>>;
  }

  /** Adds the underlying index-price column. */
  indexPrice(): OptionsBuilder<C | OptionsIndexPriceColumn> {
    return this.#withColumns([INDEX_PRICE_COLUMN]);
  }

  /**
   * Replaces the exchanges selected by the chain.
   *
   * When omitted, all options exchanges are queried.
   */
  exchanges(exchanges: readonly OptionsExchange[]): OptionsBuilder<C> {
    return this.#with({ exchanges: [...exchanges] });
  }

  /**
   * Lowers and validates the chain into raw options parameters.
   *
   * @param scope - The target, time range, and resolution to query.
   * @returns A fresh validated parameter object.
   */
  params(scope: RowsScope): OptionsParams<C> {
    const lowered: OptionsParams<C> = {
      exchanges: [...(this.#state.exchanges ?? OPTIONS_EXCHANGES)],
      columns: [...this.#state.columns],
      ...lowerRowsScope(scope),
    };
    return OptionsParams.parse(lowered);
  }

  /**
   * Lowers the chain into a lazy query without sending a request.
   *
   * A trailing duration in the scope is fixed when this method is called.
   *
   * @param scope - The target, time range, and resolution to query.
   */
  build(scope: RowsScope): Query<OptionsRow<C>, Data<OptionsExchange, C>> {
    return this.#query.build(this.params(scope));
  }

  /**
   * Builds and immediately fetches the query.
   *
   * @param scope - The target, time range, and resolution to query.
   * @param options - Per-request transport options.
   */
  fetch(scope: RowsScope, options?: HttpRequestOptions): Promise<Data<OptionsExchange, C>> {
    return this.build(scope).execute(options);
  }

  #with(patch: Partial<State<C>>): OptionsBuilder<C> {
    return new OptionsBuilder(this.#query, { ...this.#state, ...patch });
  }

  #withColumns<Added extends OptionsColumn>(columns: readonly Added[]): OptionsBuilder<C | Added> {
    const accumulated: (C | Added)[] = [...this.#state.columns];
    const seen = new Set<C | Added>(accumulated);
    for (const column of columns) {
      if (seen.has(column)) continue;
      seen.add(column);
      accumulated.push(column);
    }
    return new OptionsBuilder(this.#query, { ...this.#state, columns: accumulated });
  }
}
