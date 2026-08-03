import type { HttpRequestOptions } from "../../../transport/http.js";
import { lowerMarketRowsScope, type MarketRowsScope } from "../../common/builder/scope.js";
import { metricColumns, partColumns, splitParts } from "../../common/builder/selection.js";
import type { Data } from "../../common/data/data.js";
import type { SpotColumn } from "../../common/market/columns.js";
import { SPOT_EXCHANGES, type SpotExchange } from "../../common/market/exchanges.js";
import type { Query } from "../../common/query.js";
import { SpotParams } from "./params.js";
import { SpotQuery, type SpotRow } from "./query.js";
import {
  SPOT_SELECTOR_COLUMNS,
  type SpotPriceColumn,
  type SpotPricePart,
  type SpotTradeColumn,
  type SpotTradePart,
  type SpotVolumeColumn,
  type SpotVolumeMetric,
  type SpotVolumePart,
} from "./selectors.js";

export type { LastDuration } from "../../common/builder/time.js";
export type {
  MarketRowsScope,
  RowsScope,
  TargetScope,
  TimeScope,
} from "../../common/builder/scope.js";
/** Target, time, resolution, and optional exchanges for a spot rows query. */
export type SpotScope = MarketRowsScope<SpotExchange>;
export type {
  SpotPricePart,
  SpotTradePart,
  SpotVolumeMetric,
  SpotVolumePart,
} from "./selectors.js";

const {
  price: PRICE_COLUMNS,
  volume: VOLUME_COLUMNS,
  trades: TRADE_COLUMNS,
} = SPOT_SELECTOR_COLUMNS;

interface State<C extends SpotColumn> {
  readonly columns: readonly C[];
}

/**
 * An immutable fluent spot query under construction.
 *
 * Each selector returns a new builder, so a partially configured chain can be
 * safely reused as the base for multiple queries.
 *
 * @typeParam C - Raw spot columns selected by the chain.
 */
export class SpotBuilder<C extends SpotColumn = never> {
  readonly #query: SpotQuery;
  readonly #state: State<C>;

  constructor(query: SpotQuery, state: State<C> = { columns: [] }) {
    this.#query = query;
    this.#state = state;
  }

  /** Adds all four OHLC price columns. */
  price(): SpotBuilder<C | SpotPriceColumn>;
  /**
   * Adds the given OHLC price columns.
   *
   * @param parts - Price components to add; must not be empty.
   * @returns A new builder typed with the accumulated columns.
   */
  price<P extends SpotPricePart>(parts: readonly P[]): SpotBuilder<C | SpotPriceColumn<P>>;
  price<P extends SpotPricePart>(parts?: readonly P[]): SpotBuilder<C | SpotPriceColumn<P>> {
    const columns = partColumns("price", PRICE_COLUMNS, parts);
    return this.#withColumns(columns) as SpotBuilder<C | SpotPriceColumn<P>>;
  }

  /** Adds every dollar-volume column. */
  volume(): SpotBuilder<C | SpotVolumeColumn<"dollar">>;
  /**
   * Adds every volume column for one metric.
   *
   * @param options - Column options selecting the metric.
   * @returns A new builder typed with the accumulated columns.
   */
  volume<M extends SpotVolumeMetric>(options: {
    readonly metric: M;
  }): SpotBuilder<C | SpotVolumeColumn<M>>;
  /**
   * Adds the given dollar-volume columns.
   *
   * @param parts - Volume components to add; must not be empty.
   * @returns A new builder typed with the accumulated columns.
   */
  volume<P extends SpotVolumePart>(
    parts: readonly P[],
  ): SpotBuilder<C | SpotVolumeColumn<"dollar", P>>;
  /**
   * Adds the given volume columns for one metric.
   *
   * @param parts - Volume components to add; must not be empty.
   * @param options - Column options selecting the metric.
   * @returns A new builder typed with the accumulated columns.
   */
  volume<P extends SpotVolumePart, M extends SpotVolumeMetric>(
    parts: readonly P[],
    options: { readonly metric: M },
  ): SpotBuilder<C | SpotVolumeColumn<M, P>>;
  volume<P extends SpotVolumePart, M extends SpotVolumeMetric>(
    partsOrOptions?: readonly P[] | { readonly metric: M },
    metricOptions?: { readonly metric: M },
  ): SpotBuilder<C | SpotVolumeColumn<M, P>> {
    const { parts, options } = splitParts("volume", partsOrOptions, metricOptions);
    const columns = metricColumns("volume", VOLUME_COLUMNS, options);
    return this.#withColumns(partColumns("volume", columns, parts)) as SpotBuilder<
      C | SpotVolumeColumn<M, P>
    >;
  }

  /** Adds every trade-count column. */
  trades(): SpotBuilder<C | SpotTradeColumn>;
  /**
   * Adds the given trade-count columns.
   *
   * @param parts - Trade-count components to add; must not be empty.
   * @returns A new builder typed with the accumulated columns.
   */
  trades<P extends SpotTradePart>(parts: readonly P[]): SpotBuilder<C | SpotTradeColumn<P>>;
  trades<P extends SpotTradePart>(parts?: readonly P[]): SpotBuilder<C | SpotTradeColumn<P>> {
    const columns = partColumns("trades", TRADE_COLUMNS, parts);
    return this.#withColumns(columns) as SpotBuilder<C | SpotTradeColumn<P>>;
  }

  /**
   * Lowers and validates the chain into raw spot parameters.
   *
   * @param scope - The exchanges, target, time range, and resolution to query.
   * @returns A fresh validated parameter object.
   */
  params(scope: SpotScope): SpotParams<C> {
    const lowered: SpotParams<C> = {
      columns: [...this.#state.columns],
      ...lowerMarketRowsScope(scope, SPOT_EXCHANGES),
    };
    return SpotParams.parse(lowered);
  }

  /**
   * Lowers the chain into a lazy query without sending a request.
   *
   * A trailing duration in the scope is fixed when this method is called.
   *
   * @param scope - The exchanges, target, time range, and resolution to query.
   */
  build(scope: SpotScope): Query<SpotRow<C>, Data<SpotExchange, C>> {
    return this.#query.build(this.params(scope));
  }

  /**
   * Builds and immediately fetches the query.
   *
   * @param scope - The exchanges, target, time range, and resolution to query.
   * @param options - Per-request transport options.
   */
  fetch(scope: SpotScope, options?: HttpRequestOptions): Promise<Data<SpotExchange, C>> {
    return this.build(scope).execute(options);
  }

  #withColumns<Added extends SpotColumn>(columns: readonly Added[]): SpotBuilder<C | Added> {
    const accumulated: (C | Added)[] = [...this.#state.columns];
    const seen = new Set<C | Added>(accumulated);
    for (const column of columns) {
      if (seen.has(column)) continue;
      seen.add(column);
      accumulated.push(column);
    }
    return new SpotBuilder(this.#query, { ...this.#state, columns: accumulated });
  }
}
