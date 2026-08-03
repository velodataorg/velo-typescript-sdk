import type { HttpRequestOptions } from "../../../transport/http.ts";
import {
  type BuilderMarket,
  type BuilderWindow,
  lowerBuilderScope,
  type MarketScope,
  snapshotBuilderMarket,
  snapshotBuilderWindow,
  type WindowScope,
} from "../../common/builder/scope.ts";
import type { ScopeBuilderStep, ScopedBuilder } from "../../common/builder/scoped.ts";
import { metricColumns, partColumns, splitParts } from "../../common/builder/selection.ts";
import type { Data } from "../../common/data/data.ts";
import type { FuturesStandardColumn } from "../../common/market/columns.ts";
import { FUTURES_EXCHANGES, type FuturesExchange } from "../../common/market/exchanges.ts";
import type { Query } from "../../common/query.ts";
import { FuturesParams, type FuturesStandardParams } from "./params.ts";
import { FuturesQuery, type FuturesRow } from "./query.ts";
import {
  FUTURES_SELECTOR_COLUMNS,
  type FuturesFundingRateColumn,
  type FuturesFundingRatePart,
  type FuturesLiquidationColumn,
  type FuturesLiquidationPart,
  type FuturesLiquidationVolumeColumn,
  type FuturesLiquidationVolumeMetric,
  type FuturesLiquidationVolumePart,
  type FuturesOpenInterestColumn,
  type FuturesOpenInterestMetric,
  type FuturesOpenInterestPart,
  type FuturesPriceColumn,
  type FuturesPricePart,
  type FuturesPremiumColumn,
  type FuturesTradeColumn,
  type FuturesTradePart,
  type FuturesVolumeColumn,
  type FuturesVolumeMetric,
  type FuturesVolumePart,
} from "./selectors.ts";

export type {
  FuturesFundingRatePart,
  FuturesLiquidationPart,
  FuturesLiquidationVolumeMetric,
  FuturesLiquidationVolumePart,
  FuturesOpenInterestMetric,
  FuturesOpenInterestPart,
  FuturesPricePart,
  FuturesTradePart,
  FuturesVolumeMetric,
  FuturesVolumePart,
} from "./selectors.ts";
export type { LastDuration } from "../../common/builder/time.ts";
export type {
  MarketScope,
  MarketRowsScope,
  RowsScope,
  TargetScope,
  TimeScope,
  WindowScope,
} from "../../common/builder/scope.ts";

/** Instruments and optional exchanges configured by a futures builder's `for()` step. */
export type FuturesMarketScope = MarketScope<FuturesExchange>;

const {
  price: PRICE_COLUMNS,
  volume: VOLUME_COLUMNS,
  trades: TRADE_COLUMNS,
  openInterest: OPEN_INTEREST_COLUMNS,
  fundingRate: FUNDING_RATE_COLUMNS,
  premium: PREMIUM_COLUMN,
  liquidations: LIQUIDATION_COLUMNS,
  liquidationVolume: LIQUIDATION_VOLUME_COLUMNS,
} = FUTURES_SELECTOR_COLUMNS;

interface State<C extends FuturesStandardColumn> {
  readonly columns: readonly C[];
  readonly market?: BuilderMarket<FuturesExchange>;
  readonly window?: BuilderWindow;
}

/**
 * An immutable fluent futures query under construction.
 *
 * Each selector returns a new builder, so a partially configured chain can be
 * safely reused as the base for multiple queries.
 *
 * @typeParam C - Raw futures columns selected by the chain.
 * @typeParam S - Scope-setting methods completed by the chain.
 */
export class FuturesBuilder<
  C extends FuturesStandardColumn = never,
  S extends ScopeBuilderStep = never,
> {
  readonly #query: FuturesQuery;
  readonly #state: State<C>;

  constructor(query: FuturesQuery, state: State<C> = { columns: [] }) {
    this.#query = query;
    this.#state = state;
  }

  /** Adds all four OHLC price columns. */
  price(): FuturesBuilder<C | FuturesPriceColumn, S>;
  /**
   * Adds the given OHLC price columns.
   *
   * @param parts - Price components to add; must not be empty.
   * @returns A new builder typed with the accumulated columns.
   */
  price<P extends FuturesPricePart>(
    parts: readonly P[],
  ): FuturesBuilder<C | FuturesPriceColumn<P>, S>;
  price<P extends FuturesPricePart>(
    parts?: readonly P[],
  ): FuturesBuilder<C | FuturesPriceColumn<P>, S> {
    const columns = partColumns("price", PRICE_COLUMNS, parts);
    return this.#withColumns(columns) as FuturesBuilder<C | FuturesPriceColumn<P>, S>;
  }

  /** Adds every dollar-volume column. */
  volume(): FuturesBuilder<C | FuturesVolumeColumn<"dollar">, S>;
  /**
   * Adds every volume column for one metric.
   *
   * @param options - Column options selecting the metric.
   * @returns A new builder typed with the accumulated columns.
   */
  volume<M extends FuturesVolumeMetric>(options: {
    readonly metric: M;
  }): FuturesBuilder<C | FuturesVolumeColumn<M>, S>;
  /**
   * Adds the given dollar-volume columns.
   *
   * @param parts - Volume components to add; must not be empty.
   * @returns A new builder typed with the accumulated columns.
   */
  volume<P extends FuturesVolumePart>(
    parts: readonly P[],
  ): FuturesBuilder<C | FuturesVolumeColumn<"dollar", P>, S>;
  /**
   * Adds the given volume columns for one metric.
   *
   * @param parts - Volume components to add; must not be empty.
   * @param options - Column options selecting the metric.
   * @returns A new builder typed with the accumulated columns.
   */
  volume<P extends FuturesVolumePart, M extends FuturesVolumeMetric>(
    parts: readonly P[],
    options: { readonly metric: M },
  ): FuturesBuilder<C | FuturesVolumeColumn<M, P>, S>;
  volume<P extends FuturesVolumePart, M extends FuturesVolumeMetric>(
    partsOrOptions?: readonly P[] | { readonly metric: M },
    metricOptions?: { readonly metric: M },
  ): FuturesBuilder<C | FuturesVolumeColumn<M, P>, S> {
    const { parts, options } = splitParts("volume", partsOrOptions, metricOptions);
    const columns = metricColumns("volume", VOLUME_COLUMNS, options);
    return this.#withColumns(partColumns("volume", columns, parts)) as FuturesBuilder<
      C | FuturesVolumeColumn<M, P>,
      S
    >;
  }

  /** Adds every trade-count column. */
  trades(): FuturesBuilder<C | FuturesTradeColumn, S>;
  /**
   * Adds the given trade-count columns.
   *
   * @param parts - Trade-count components to add; must not be empty.
   * @returns A new builder typed with the accumulated columns.
   */
  trades<P extends FuturesTradePart>(
    parts: readonly P[],
  ): FuturesBuilder<C | FuturesTradeColumn<P>, S>;
  trades<P extends FuturesTradePart>(
    parts?: readonly P[],
  ): FuturesBuilder<C | FuturesTradeColumn<P>, S> {
    const columns = partColumns("trades", TRADE_COLUMNS, parts);
    return this.#withColumns(columns) as FuturesBuilder<C | FuturesTradeColumn<P>, S>;
  }

  /** Adds every dollar open-interest column. */
  openInterest(): FuturesBuilder<C | FuturesOpenInterestColumn<"dollar">, S>;
  /**
   * Adds every open-interest column for one metric.
   *
   * @param options - Column options selecting the metric.
   * @returns A new builder typed with the accumulated columns.
   */
  openInterest<M extends FuturesOpenInterestMetric>(options: {
    readonly metric: M;
  }): FuturesBuilder<C | FuturesOpenInterestColumn<M>, S>;
  /**
   * Adds the given dollar open-interest columns.
   *
   * @param parts - Open-interest components to add; must not be empty.
   * @returns A new builder typed with the accumulated columns.
   */
  openInterest<P extends FuturesOpenInterestPart>(
    parts: readonly P[],
  ): FuturesBuilder<C | FuturesOpenInterestColumn<"dollar", P>, S>;
  /**
   * Adds the given open-interest columns for one metric.
   *
   * @param parts - Open-interest components to add; must not be empty.
   * @param options - Column options selecting the metric.
   * @returns A new builder typed with the accumulated columns.
   */
  openInterest<P extends FuturesOpenInterestPart, M extends FuturesOpenInterestMetric>(
    parts: readonly P[],
    options: { readonly metric: M },
  ): FuturesBuilder<C | FuturesOpenInterestColumn<M, P>, S>;
  openInterest<P extends FuturesOpenInterestPart, M extends FuturesOpenInterestMetric>(
    partsOrOptions?: readonly P[] | { readonly metric: M },
    metricOptions?: { readonly metric: M },
  ): FuturesBuilder<C | FuturesOpenInterestColumn<M, P>, S> {
    const { parts, options } = splitParts("openInterest", partsOrOptions, metricOptions);
    const columns = metricColumns("openInterest", OPEN_INTEREST_COLUMNS, options);
    return this.#withColumns(partColumns("openInterest", columns, parts)) as FuturesBuilder<
      C | FuturesOpenInterestColumn<M, P>,
      S
    >;
  }

  /** Adds both funding-rate columns. */
  fundingRate(): FuturesBuilder<C | FuturesFundingRateColumn, S>;
  /**
   * Adds the given funding-rate columns.
   *
   * @param parts - Funding-rate components to add; must not be empty.
   * @returns A new builder typed with the accumulated columns.
   */
  fundingRate<P extends FuturesFundingRatePart>(
    parts: readonly P[],
  ): FuturesBuilder<C | FuturesFundingRateColumn<P>, S>;
  fundingRate<P extends FuturesFundingRatePart>(
    parts?: readonly P[],
  ): FuturesBuilder<C | FuturesFundingRateColumn<P>, S> {
    const columns = partColumns("fundingRate", FUNDING_RATE_COLUMNS, parts);
    return this.#withColumns(columns) as FuturesBuilder<C | FuturesFundingRateColumn<P>, S>;
  }

  /** Adds the futures premium column. */
  premium(): FuturesBuilder<C | FuturesPremiumColumn, S> {
    return this.#withColumns([PREMIUM_COLUMN]);
  }

  /** Adds both liquidation-count columns. */
  liquidations(): FuturesBuilder<C | FuturesLiquidationColumn, S>;
  /**
   * Adds the given liquidation-count columns.
   *
   * @param parts - Liquidation sides to add; must not be empty.
   * @returns A new builder typed with the accumulated columns.
   */
  liquidations<P extends FuturesLiquidationPart>(
    parts: readonly P[],
  ): FuturesBuilder<C | FuturesLiquidationColumn<P>, S>;
  liquidations<P extends FuturesLiquidationPart>(
    parts?: readonly P[],
  ): FuturesBuilder<C | FuturesLiquidationColumn<P>, S> {
    const columns = partColumns("liquidations", LIQUIDATION_COLUMNS, parts);
    return this.#withColumns(columns) as FuturesBuilder<C | FuturesLiquidationColumn<P>, S>;
  }

  /** Adds every dollar liquidation-volume column. */
  liquidationVolume(): FuturesBuilder<C | FuturesLiquidationVolumeColumn<"dollar">, S>;
  /**
   * Adds every liquidation-volume column for one metric.
   *
   * @param options - Column options selecting the metric.
   * @returns A new builder typed with the accumulated columns.
   */
  liquidationVolume<M extends FuturesLiquidationVolumeMetric>(options: {
    readonly metric: M;
  }): FuturesBuilder<C | FuturesLiquidationVolumeColumn<M>, S>;
  /**
   * Adds the given dollar liquidation-volume columns.
   *
   * @param parts - Liquidation-volume components to add; must not be empty.
   * @returns A new builder typed with the accumulated columns.
   */
  liquidationVolume<P extends FuturesLiquidationVolumePart>(
    parts: readonly P[],
  ): FuturesBuilder<C | FuturesLiquidationVolumeColumn<"dollar", P>, S>;
  /**
   * Adds the given liquidation-volume columns for one metric.
   *
   * @param parts - Liquidation-volume components to add; must not be empty.
   * @param options - Column options selecting the metric.
   * @returns A new builder typed with the accumulated columns.
   */
  liquidationVolume<
    P extends FuturesLiquidationVolumePart,
    M extends FuturesLiquidationVolumeMetric,
  >(
    parts: readonly P[],
    options: { readonly metric: M },
  ): FuturesBuilder<C | FuturesLiquidationVolumeColumn<M, P>, S>;
  liquidationVolume<
    P extends FuturesLiquidationVolumePart,
    M extends FuturesLiquidationVolumeMetric,
  >(
    partsOrOptions?: readonly P[] | { readonly metric: M },
    metricOptions?: { readonly metric: M },
  ): FuturesBuilder<C | FuturesLiquidationVolumeColumn<M, P>, S> {
    const { parts, options } = splitParts("liquidationVolume", partsOrOptions, metricOptions);
    const columns = metricColumns("liquidationVolume", LIQUIDATION_VOLUME_COLUMNS, options);
    return this.#withColumns(partColumns("liquidationVolume", columns, parts)) as FuturesBuilder<
      C | FuturesLiquidationVolumeColumn<M, P>,
      S
    >;
  }

  /** Replaces the instruments and exchanges selected by the chain. */
  for(scope: FuturesMarketScope): FuturesBuilder<C, S | "for"> {
    return new FuturesBuilder<C, S | "for">(this.#query, {
      ...this.#state,
      market: snapshotBuilderMarket(scope, FUTURES_EXCHANGES),
    });
  }

  /** Replaces the time window and resolution selected by the chain. */
  over(scope: WindowScope): FuturesBuilder<C, S | "over"> {
    return new FuturesBuilder<C, S | "over">(this.#query, {
      ...this.#state,
      window: snapshotBuilderWindow(scope),
    });
  }

  /** Lowers and validates the chain into fresh raw futures parameters. */
  params(this: ScopedBuilder<FuturesBuilder<C, S>, S>): FuturesStandardParams<C> {
    return this.#params();
  }

  /**
   * Lowers the chain into a lazy query without sending a request.
   *
   * A trailing duration configured by `over()` is fixed when this method is called.
   */
  build(
    this: ScopedBuilder<FuturesBuilder<C, S>, S>,
  ): Query<FuturesRow<C>, Data<FuturesExchange, C>> {
    return this.#build();
  }

  /**
   * Builds and immediately fetches the query.
   *
   * @param options - Per-request transport options.
   */
  fetch(
    this: ScopedBuilder<FuturesBuilder<C, S>, S>,
    options?: HttpRequestOptions,
  ): Promise<Data<FuturesExchange, C>> {
    return this.#build().execute(options);
  }

  /** Builds and streams decoded rows without collecting them into a {@link Data} object. */
  stream(
    this: ScopedBuilder<FuturesBuilder<C, S>, S>,
    options?: HttpRequestOptions,
  ): AsyncIterable<FuturesRow<C>> {
    return this.#build().stream(options);
  }

  #withColumns<Added extends FuturesStandardColumn>(
    columns: readonly Added[],
  ): FuturesBuilder<C | Added, S> {
    const accumulated: (C | Added)[] = [...this.#state.columns];
    const seen = new Set<C | Added>(accumulated);
    for (const column of columns) {
      if (seen.has(column)) continue;
      seen.add(column);
      accumulated.push(column);
    }
    return new FuturesBuilder<C | Added, S>(this.#query, {
      ...this.#state,
      columns: accumulated,
    });
  }

  #params(): FuturesStandardParams<C> {
    const lowered: FuturesStandardParams<C> = {
      columns: [...this.#state.columns],
      ...lowerBuilderScope(this.#state.market, this.#state.window),
    };
    return FuturesParams.parse(lowered);
  }

  #build(): Query<FuturesRow<C>, Data<FuturesExchange, C>> {
    return this.#query.build(this.#params());
  }
}
