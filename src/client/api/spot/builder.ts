import {
  type BuilderMarket,
  type BuilderWindow,
  lowerBuilderScope,
  type MarketScope,
  snapshotBuilderMarket,
  snapshotBuilderWindow,
  type TargetScope,
  type WindowScope,
} from "../../builder/scope.ts";
import type { ScopeBuilderStep, ScopedBuilder } from "../../builder/scoped.ts";
import { byMetric, partColumns, splitParts } from "../../builder/selection.ts";
import type { SpotColumn } from "../../market/columns.ts";
import { SPOT_EXCHANGES, type SpotExchange } from "../../market/exchanges.ts";
import type { QueryRequest } from "../../query/plan.ts";
import { SpotParams, type SpotParams as SpotParamsType } from "./params.ts";
import {
  SPOT_SELECTOR_COLUMNS,
  type SpotPriceColumn,
  type SpotPricePart,
  type SpotTradeColumn,
  type SpotTradePart,
  type SpotVolumeColumn,
  type SpotVolumeMetric,
  type SpotVolumePart,
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
/** Instruments and optional exchanges configured by a spot builder's `for()` step. */
export type SpotMarketScope = MarketScope<SpotExchange>;
export type {
  SpotPricePart,
  SpotTradePart,
  SpotVolumeMetric,
  SpotVolumePart,
} from "./selectors.ts";

const {
  price: PRICE_COLUMNS,
  volume: VOLUME_COLUMNS,
  trades: TRADE_COLUMNS,
} = SPOT_SELECTOR_COLUMNS;

interface State<C extends SpotColumn, E extends SpotExchange> {
  readonly columns: readonly C[];
  readonly market?: BuilderMarket<E>;
  readonly window?: BuilderWindow;
}

/**
 * An immutable fluent spot request builder.
 *
 * Each selector returns a new builder, so a partially configured chain can be
 * safely reused as the base for multiple queries.
 *
 * @typeParam C - Raw spot columns selected by the chain.
 * @typeParam E - Exchanges selected by the chain.
 * @typeParam S - Scope-setting methods completed by the chain.
 */
export class SpotBuilder<
  C extends SpotColumn = never,
  E extends SpotExchange = SpotExchange,
  S extends ScopeBuilderStep = never,
> {
  readonly #state: State<C, E>;

  constructor(state: State<C, E> = { columns: [] }) {
    this.#state = state;
  }

  /** Adds all four OHLC price columns. */
  price(): SpotBuilder<C | SpotPriceColumn, E, S>;
  /**
   * Adds the given OHLC price columns.
   *
   * @param parts - Price components to add; must not be empty.
   * @returns A new builder typed with the accumulated columns.
   */
  price<P extends SpotPricePart>(parts: readonly P[]): SpotBuilder<C | SpotPriceColumn<P>, E, S>;
  price<P extends SpotPricePart>(parts?: readonly P[]): SpotBuilder<C | SpotPriceColumn<P>, E, S> {
    const columns = partColumns("price", PRICE_COLUMNS, parts);
    return this.#withColumns(columns) as SpotBuilder<C | SpotPriceColumn<P>, E, S>;
  }

  /** Adds every dollar-volume column. */
  volume(): SpotBuilder<C | SpotVolumeColumn<"dollar">, E, S>;
  /**
   * Adds every volume column for one metric.
   *
   * @param options - Column options selecting the metric.
   * @returns A new builder typed with the accumulated columns.
   */
  volume<M extends SpotVolumeMetric>(options: {
    readonly metric: M;
  }): SpotBuilder<C | SpotVolumeColumn<M>, E, S>;
  /**
   * Adds the given dollar-volume columns.
   *
   * @param parts - Volume components to add; must not be empty.
   * @returns A new builder typed with the accumulated columns.
   */
  volume<P extends SpotVolumePart>(
    parts: readonly P[],
  ): SpotBuilder<C | SpotVolumeColumn<"dollar", P>, E, S>;
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
  ): SpotBuilder<C | SpotVolumeColumn<M, P>, E, S>;
  volume<P extends SpotVolumePart, M extends SpotVolumeMetric>(
    partsOrOptions?: readonly P[] | { readonly metric: M },
    metricOptions?: { readonly metric: M },
  ): SpotBuilder<C | SpotVolumeColumn<M, P>, E, S> {
    const { parts, options } = splitParts("volume", partsOrOptions, metricOptions);
    const columns = byMetric("volume", VOLUME_COLUMNS, options);
    return this.#withColumns(partColumns("volume", columns, parts)) as SpotBuilder<
      C | SpotVolumeColumn<M, P>,
      E,
      S
    >;
  }

  /** Adds every trade-count column. */
  trades(): SpotBuilder<C | SpotTradeColumn, E, S>;
  /**
   * Adds the given trade-count columns.
   *
   * @param parts - Trade-count components to add; must not be empty.
   * @returns A new builder typed with the accumulated columns.
   */
  trades<P extends SpotTradePart>(parts: readonly P[]): SpotBuilder<C | SpotTradeColumn<P>, E, S>;
  trades<P extends SpotTradePart>(parts?: readonly P[]): SpotBuilder<C | SpotTradeColumn<P>, E, S> {
    const columns = partColumns("trades", TRADE_COLUMNS, parts);
    return this.#withColumns(columns) as SpotBuilder<C | SpotTradeColumn<P>, E, S>;
  }

  /** Replaces the instruments and exchanges selected by the chain. */
  for<SE extends SpotExchange>(
    scope: TargetScope & { readonly exchanges: readonly SE[] },
  ): SpotBuilder<C, SE, S | "for">;
  for(scope: SpotMarketScope): SpotBuilder<C, SpotExchange, S | "for">;
  for(scope: SpotMarketScope): SpotBuilder<C, SpotExchange, S | "for"> {
    return new SpotBuilder<C, SpotExchange, S | "for">({
      ...this.#state,
      market: snapshotBuilderMarket(scope, SPOT_EXCHANGES),
    });
  }

  /** Replaces the time window and resolution selected by the chain. */
  over(scope: WindowScope): SpotBuilder<C, E, S | "over"> {
    return new SpotBuilder<C, E, S | "over">({
      ...this.#state,
      window: snapshotBuilderWindow(scope),
    });
  }

  /** Lowers and validates the chain into fresh raw spot parameters. */
  params(this: ScopedBuilder<SpotBuilder<C, E, S>, S>): SpotParams<C, E> {
    return this.#params();
  }

  /**
   * Lowers the chain into an immutable transport-independent request.
   *
   * A trailing duration configured by `over()` is fixed when this method is called.
   */
  build(
    this: ScopedBuilder<SpotBuilder<C, E, S>, S>,
    ...ready: ScopeBuilderStep extends S ? [] : [never]
  ): QueryRequest<"spot.rows", SpotParamsType<C, E>> {
    void ready;
    return this.#build();
  }

  #withColumns<Added extends SpotColumn>(columns: readonly Added[]): SpotBuilder<C | Added, E, S> {
    const accumulated: (C | Added)[] = [...this.#state.columns];
    const seen = new Set<C | Added>(accumulated);
    for (const column of columns) {
      if (seen.has(column)) continue;
      seen.add(column);
      accumulated.push(column);
    }
    return new SpotBuilder<C | Added, E, S>({
      ...this.#state,
      columns: accumulated,
    });
  }

  #params(): SpotParams<C, E> {
    const lowered: SpotParams<C, E> = {
      columns: [...this.#state.columns],
      ...lowerBuilderScope(this.#state.market, this.#state.window),
    };
    return SpotParams.parse(lowered);
  }

  #build(): QueryRequest<"spot.rows", SpotParamsType<C, E>> {
    const params = freezeSpotRowsParams(this.#params());
    return Object.freeze({ kind: "spot.rows", params });
  }
}

function freezeSpotRowsParams<C extends SpotColumn, E extends SpotExchange>(
  params: SpotParamsType<C, E>,
): SpotParamsType<C, E> {
  Object.freeze(params.exchanges);
  Object.freeze(params.columns);
  if (params.products !== undefined) Object.freeze(params.products);
  if (params.coins !== undefined) Object.freeze(params.coins);
  return Object.freeze(params);
}
