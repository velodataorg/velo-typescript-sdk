import type { HttpRequestOptions } from "../../../transport/http.js";
import { assert } from "../../../util/assert.js";
import { metricColumns, partColumns, splitParts } from "../../common/builder/selection.js";
import {
  betweenTime,
  type BuilderTime,
  lastTime,
  type LastDuration,
  lowerTime,
} from "../../common/builder/time.js";
import type { Data } from "../../common/data/data.js";
import type { OptionsColumn } from "../../common/market/columns.js";
import { OPTIONS_EXCHANGES, type OptionsExchange } from "../../common/market/exchanges.js";
import type { Query } from "../../common/query.js";
import type { Resolution } from "../../common/rows/resolution.js";
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

interface State {
  readonly columns: readonly OptionsColumn[];
  readonly exchanges?: readonly OptionsExchange[];
  readonly selection?:
    | { readonly kind: "products"; readonly values: readonly string[] }
    | { readonly kind: "coins"; readonly values: readonly string[] };
  readonly time?: BuilderTime;
  readonly resolution?: Resolution;
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
  readonly #state: State;

  constructor(query: OptionsQuery, state: State = { columns: [] }) {
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
   * Replaces the products selected by the chain.
   *
   * @throws {@link VeloError} when coins have already been selected.
   */
  products(products: readonly string[]): OptionsBuilder<C> {
    assert(
      this.#state.selection?.kind !== "coins",
      "products() cannot be used after coins() on the same chain",
    );
    return this.#with({ selection: { kind: "products", values: [...products] } });
  }

  /**
   * Replaces the coins selected by the chain.
   *
   * @throws {@link VeloError} when products have already been selected.
   */
  coins(coins: readonly string[]): OptionsBuilder<C> {
    assert(
      this.#state.selection?.kind !== "products",
      "coins() cannot be used after products() on the same chain",
    );
    return this.#with({ selection: { kind: "coins", values: [...coins] } });
  }

  /**
   * Replaces the time selection with an explicit half-open range.
   *
   * Date inputs are snapshotted as millisecond timestamps when this method is
   * called.
   */
  between(begin: number | Date, end: number | Date): OptionsBuilder<C> {
    return this.#with({ time: betweenTime(begin, end) });
  }

  /**
   * Replaces the time selection with a trailing duration.
   *
   * The current time is read by {@link OptionsBuilder.params | params()},
   * {@link OptionsBuilder.build | build()}, or
   * {@link OptionsBuilder.execute | execute()}, rather than by this method.
   */
  last(duration: LastDuration): OptionsBuilder<C> {
    return this.#with({ time: lastTime(duration) });
  }

  /** Replaces the query resolution. */
  resolution(resolution: Resolution): OptionsBuilder<C> {
    return this.#with({ resolution });
  }

  /**
   * Lowers and validates the chain into raw options parameters.
   *
   * @returns A fresh validated parameter object.
   */
  params(): OptionsParams<C> {
    return OptionsParams.parse(this.#lower());
  }

  /**
   * Lowers the chain into a lazy query without sending a request.
   *
   * A trailing duration is fixed when this method is called.
   */
  build(): Query<OptionsRow<C>, Data<OptionsExchange, C>> {
    return this.#query.build(this.#lower());
  }

  /**
   * Lowers and immediately executes the chain.
   *
   * @param options - Per-request transport options.
   */
  execute(options?: HttpRequestOptions): Promise<Data<OptionsExchange, C>> {
    return this.build().execute(options);
  }

  #with(patch: Partial<State>): OptionsBuilder<C> {
    return new OptionsBuilder(this.#query, { ...this.#state, ...patch });
  }

  #withColumns<Added extends OptionsColumn>(columns: readonly Added[]): OptionsBuilder<C | Added> {
    const accumulated = [...this.#state.columns];
    const seen = new Set(accumulated);
    for (const column of columns) {
      if (seen.has(column)) continue;
      seen.add(column);
      accumulated.push(column);
    }
    return new OptionsBuilder(this.#query, { ...this.#state, columns: accumulated });
  }

  #lower(): OptionsParams<C> {
    const selection = this.#state.selection;
    const target =
      selection === undefined
        ? {}
        : selection.kind === "products"
          ? { products: [...selection.values] }
          : { coins: [...selection.values] };

    const resolution =
      this.#state.resolution === undefined ? {} : { resolution: this.#state.resolution };

    /* The parser or raw query immediately validates builders that are still incomplete. */
    return {
      exchanges: [...(this.#state.exchanges ?? OPTIONS_EXCHANGES)],
      columns: [...this.#state.columns] as C[],
      ...target,
      ...lowerTime(this.#state.time),
      ...resolution,
    } as unknown as OptionsParams<C>;
  }
}
