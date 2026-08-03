import type { HttpRequestOptions } from "../../../transport/http.js";
import {
  type BuilderMarket,
  type BuilderWindow,
  lowerBuilderScope,
  type MarketScope,
  snapshotBuilderMarket,
  snapshotBuilderWindow,
  type WindowScope,
} from "../../common/builder/scope.js";
import type { ScopeBuilderStep, ScopedBuilder } from "../../common/builder/scoped.js";
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
  MarketScope,
  MarketRowsScope,
  RowsScope,
  TargetScope,
  TimeScope,
  WindowScope,
} from "../../common/builder/scope.js";
/** Instruments and optional exchanges configured by a spot builder's `for()` step. */
export type SpotMarketScope = MarketScope<SpotExchange>;
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
  readonly market?: BuilderMarket<SpotExchange>;
  readonly window?: BuilderWindow;
}

/**
 * An immutable fluent spot query under construction.
 *
 * Each selector returns a new builder, so a partially configured chain can be
 * safely reused as the base for multiple queries.
 *
 * @typeParam C - Raw spot columns selected by the chain.
 * @typeParam S - Scope-setting methods completed by the chain.
 */
export class SpotBuilder<C extends SpotColumn = never, S extends ScopeBuilderStep = never> {
  readonly #query: SpotQuery;
  readonly #state: State<C>;

  constructor(query: SpotQuery, state: State<C> = { columns: [] }) {
    this.#query = query;
    this.#state = state;
  }

  /** Adds all four OHLC price columns. */
  price(): SpotBuilder<C | SpotPriceColumn, S>;
  /**
   * Adds the given OHLC price columns.
   *
   * @param parts - Price components to add; must not be empty.
   * @returns A new builder typed with the accumulated columns.
   */
  price<P extends SpotPricePart>(parts: readonly P[]): SpotBuilder<C | SpotPriceColumn<P>, S>;
  price<P extends SpotPricePart>(parts?: readonly P[]): SpotBuilder<C | SpotPriceColumn<P>, S> {
    const columns = partColumns("price", PRICE_COLUMNS, parts);
    return this.#withColumns(columns) as SpotBuilder<C | SpotPriceColumn<P>, S>;
  }

  /** Adds every dollar-volume column. */
  volume(): SpotBuilder<C | SpotVolumeColumn<"dollar">, S>;
  /**
   * Adds every volume column for one metric.
   *
   * @param options - Column options selecting the metric.
   * @returns A new builder typed with the accumulated columns.
   */
  volume<M extends SpotVolumeMetric>(options: {
    readonly metric: M;
  }): SpotBuilder<C | SpotVolumeColumn<M>, S>;
  /**
   * Adds the given dollar-volume columns.
   *
   * @param parts - Volume components to add; must not be empty.
   * @returns A new builder typed with the accumulated columns.
   */
  volume<P extends SpotVolumePart>(
    parts: readonly P[],
  ): SpotBuilder<C | SpotVolumeColumn<"dollar", P>, S>;
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
  ): SpotBuilder<C | SpotVolumeColumn<M, P>, S>;
  volume<P extends SpotVolumePart, M extends SpotVolumeMetric>(
    partsOrOptions?: readonly P[] | { readonly metric: M },
    metricOptions?: { readonly metric: M },
  ): SpotBuilder<C | SpotVolumeColumn<M, P>, S> {
    const { parts, options } = splitParts("volume", partsOrOptions, metricOptions);
    const columns = metricColumns("volume", VOLUME_COLUMNS, options);
    return this.#withColumns(partColumns("volume", columns, parts)) as SpotBuilder<
      C | SpotVolumeColumn<M, P>,
      S
    >;
  }

  /** Adds every trade-count column. */
  trades(): SpotBuilder<C | SpotTradeColumn, S>;
  /**
   * Adds the given trade-count columns.
   *
   * @param parts - Trade-count components to add; must not be empty.
   * @returns A new builder typed with the accumulated columns.
   */
  trades<P extends SpotTradePart>(parts: readonly P[]): SpotBuilder<C | SpotTradeColumn<P>, S>;
  trades<P extends SpotTradePart>(parts?: readonly P[]): SpotBuilder<C | SpotTradeColumn<P>, S> {
    const columns = partColumns("trades", TRADE_COLUMNS, parts);
    return this.#withColumns(columns) as SpotBuilder<C | SpotTradeColumn<P>, S>;
  }

  /** Replaces the instruments and exchanges selected by the chain. */
  for(scope: SpotMarketScope): SpotBuilder<C, S | "for"> {
    return new SpotBuilder<C, S | "for">(this.#query, {
      ...this.#state,
      market: snapshotBuilderMarket(scope, SPOT_EXCHANGES),
    });
  }

  /** Replaces the time window and resolution selected by the chain. */
  over(scope: WindowScope): SpotBuilder<C, S | "over"> {
    return new SpotBuilder<C, S | "over">(this.#query, {
      ...this.#state,
      window: snapshotBuilderWindow(scope),
    });
  }

  /** Lowers and validates the chain into fresh raw spot parameters. */
  params(this: ScopedBuilder<SpotBuilder<C, S>, S>): SpotParams<C> {
    return this.#params();
  }

  /**
   * Lowers the chain into a lazy query without sending a request.
   *
   * A trailing duration configured by `over()` is fixed when this method is called.
   */
  build(this: ScopedBuilder<SpotBuilder<C, S>, S>): Query<SpotRow<C>, Data<SpotExchange, C>> {
    return this.#build();
  }

  /**
   * Builds and immediately fetches the query.
   *
   * @param options - Per-request transport options.
   */
  fetch(
    this: ScopedBuilder<SpotBuilder<C, S>, S>,
    options?: HttpRequestOptions,
  ): Promise<Data<SpotExchange, C>> {
    return this.#build().execute(options);
  }

  /** Builds and streams decoded rows without collecting them into a {@link Data} object. */
  stream(
    this: ScopedBuilder<SpotBuilder<C, S>, S>,
    options?: HttpRequestOptions,
  ): AsyncIterable<SpotRow<C>> {
    return this.#build().stream(options);
  }

  #withColumns<Added extends SpotColumn>(columns: readonly Added[]): SpotBuilder<C | Added, S> {
    const accumulated: (C | Added)[] = [...this.#state.columns];
    const seen = new Set<C | Added>(accumulated);
    for (const column of columns) {
      if (seen.has(column)) continue;
      seen.add(column);
      accumulated.push(column);
    }
    return new SpotBuilder<C | Added, S>(this.#query, {
      ...this.#state,
      columns: accumulated,
    });
  }

  #params(): SpotParams<C> {
    const lowered: SpotParams<C> = {
      columns: [...this.#state.columns],
      ...lowerBuilderScope(this.#state.market, this.#state.window),
    };
    return SpotParams.parse(lowered);
  }

  #build(): Query<SpotRow<C>, Data<SpotExchange, C>> {
    return this.#query.build(this.#params());
  }
}
