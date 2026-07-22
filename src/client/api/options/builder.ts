import type { HttpRequestOptions } from "../../../transport/http.js";
import { assert } from "../../../util/assert.js";
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

  /**
   * Adds one or more implied-volatility tenor columns.
   *
   * @param tenors - Tenors to add; defaults to all tenors when omitted.
   * @returns A new builder typed with the accumulated columns.
   */
  iv<T extends OptionsIvTenor = OptionsIvTenor>(
    ...tenors: readonly T[]
  ): OptionsBuilder<C | OptionsIvColumn<T>> {
    const columns =
      tenors.length === 0 ? Object.values(IV_COLUMNS) : tenors.map((tenor) => IV_COLUMNS[tenor]);
    return this.#withColumns(columns) as OptionsBuilder<C | OptionsIvColumn<T>>;
  }

  /**
   * Adds one or more skew tenor columns.
   *
   * @param tenors - Tenors to add; defaults to all tenors when omitted.
   * @returns A new builder typed with the accumulated columns.
   */
  skew<T extends OptionsSkewTenor = OptionsSkewTenor>(
    ...tenors: readonly T[]
  ): OptionsBuilder<C | OptionsSkewColumn<T>> {
    const columns =
      tenors.length === 0
        ? Object.values(SKEW_COLUMNS)
        : tenors.map((tenor) => SKEW_COLUMNS[tenor]);
    return this.#withColumns(columns) as OptionsBuilder<C | OptionsSkewColumn<T>>;
  }

  /**
   * Adds one vega column.
   *
   * @param options - Column options; the metric defaults to `"dollar"`.
   */
  vega<M extends OptionsVegaMetric = "dollar">(options?: {
    readonly metric: M;
  }): OptionsBuilder<C | OptionsVegaColumn<M>> {
    const metric = options?.metric ?? "dollar";
    return this.#withColumns([VEGA_COLUMNS[metric]]) as OptionsBuilder<C | OptionsVegaColumn<M>>;
  }

  /**
   * Adds one delta column, or both option sides for one metric when the part is omitted.
   *
   * @param part - Option side to add; defaults to both sides when omitted.
   * @param options - Column options; the metric defaults to `"dollar"`.
   * @returns A new builder typed with the accumulated columns.
   */
  delta<P extends OptionsDeltaPart = OptionsDeltaPart, M extends OptionsDeltaMetric = "dollar">(
    part?: P,
    options?: { readonly metric: M },
  ): OptionsBuilder<C | OptionsDeltaColumn<M, P>> {
    const metric = options?.metric ?? "dollar";
    const columns = DELTA_COLUMNS[metric];
    const selected = part === undefined ? Object.values(columns) : [columns[part]];
    return this.#withColumns(selected) as OptionsBuilder<C | OptionsDeltaColumn<M, P>>;
  }

  /**
   * Adds one gamma column.
   *
   * @param options - Column options; the metric defaults to `"dollar"`.
   */
  gamma<M extends OptionsGammaMetric = "dollar">(options?: {
    readonly metric: M;
  }): OptionsBuilder<C | OptionsGammaColumn<M>> {
    const metric = options?.metric ?? "dollar";
    return this.#withColumns([GAMMA_COLUMNS[metric]]) as OptionsBuilder<C | OptionsGammaColumn<M>>;
  }

  /**
   * Adds one call/put volume column, or both when the side is omitted.
   *
   * @param part - Option side to add; defaults to both sides when omitted.
   * @returns A new builder typed with the accumulated columns.
   */
  volume<P extends OptionsVolumePart = OptionsVolumePart>(
    part?: P,
  ): OptionsBuilder<C | OptionsVolumeColumn<P>> {
    const columns = part === undefined ? Object.values(VOLUME_COLUMNS) : [VOLUME_COLUMNS[part]];
    return this.#withColumns(columns) as OptionsBuilder<C | OptionsVolumeColumn<P>>;
  }

  /** Adds total dollar volume. */
  dollarVolume(): OptionsBuilder<C | OptionsDollarVolumeColumn> {
    return this.#withColumns([DOLLAR_VOLUME_COLUMN]);
  }

  /**
   * Adds one call/put premium column, or both when the side is omitted.
   *
   * @param part - Option side to add; defaults to both sides when omitted.
   * @returns A new builder typed with the accumulated columns.
   */
  premium<P extends OptionsPremiumPart = OptionsPremiumPart>(
    part?: P,
  ): OptionsBuilder<C | OptionsPremiumColumn<P>> {
    const columns = part === undefined ? Object.values(PREMIUM_COLUMNS) : [PREMIUM_COLUMNS[part]];
    return this.#withColumns(columns) as OptionsBuilder<C | OptionsPremiumColumn<P>>;
  }

  /**
   * Adds one call/put notional column, or both when the side is omitted.
   *
   * @param part - Option side to add; defaults to both sides when omitted.
   * @returns A new builder typed with the accumulated columns.
   */
  notional<P extends OptionsNotionalPart = OptionsNotionalPart>(
    part?: P,
  ): OptionsBuilder<C | OptionsNotionalColumn<P>> {
    const columns = part === undefined ? Object.values(NOTIONAL_COLUMNS) : [NOTIONAL_COLUMNS[part]];
    return this.#withColumns(columns) as OptionsBuilder<C | OptionsNotionalColumn<P>>;
  }

  /**
   * Adds one or more DVOL OHLC columns.
   *
   * @param parts - Price components to add; defaults to all components when omitted.
   * @returns A new builder typed with the accumulated columns.
   */
  dvol<P extends OptionsDvolPart = OptionsDvolPart>(
    ...parts: readonly P[]
  ): OptionsBuilder<C | OptionsDvolColumn<P>> {
    const columns =
      parts.length === 0 ? Object.values(DVOL_COLUMNS) : parts.map((part) => DVOL_COLUMNS[part]);
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
