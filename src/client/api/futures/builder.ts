import type { HttpRequestOptions } from "../../../transport/http.js";
import { lowerMarketRowsScope, type MarketRowsScope } from "../../common/builder/scope.js";
import { metricColumns, partColumns, splitParts } from "../../common/builder/selection.js";
import type { Data } from "../../common/data/data.js";
import type { FuturesStandardColumn } from "../../common/market/columns.js";
import { FUTURES_EXCHANGES, type FuturesExchange } from "../../common/market/exchanges.js";
import type { Query } from "../../common/query.js";
import { FuturesParams, type FuturesStandardParams } from "./params.js";
import { FuturesQuery, type FuturesRow } from "./query.js";
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
} from "./selectors.js";

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
} from "./selectors.js";
export type { LastDuration } from "../../common/builder/time.js";
export type {
  MarketRowsScope,
  RowsScope,
  TargetScope,
  TimeScope,
} from "../../common/builder/scope.js";

/** Target, time, resolution, and optional exchanges for a futures rows query. */
export type FuturesScope = MarketRowsScope<FuturesExchange>;

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
}

/**
 * An immutable fluent futures query under construction.
 *
 * Each selector returns a new builder, so a partially configured chain can be
 * safely reused as the base for multiple queries.
 *
 * @typeParam C - Raw futures columns selected by the chain.
 */
export class FuturesBuilder<C extends FuturesStandardColumn = never> {
  readonly #query: FuturesQuery;
  readonly #state: State<C>;

  constructor(query: FuturesQuery, state: State<C> = { columns: [] }) {
    this.#query = query;
    this.#state = state;
  }

  /** Adds all four OHLC price columns. */
  price(): FuturesBuilder<C | FuturesPriceColumn>;
  /**
   * Adds the given OHLC price columns.
   *
   * @param parts - Price components to add; must not be empty.
   * @returns A new builder typed with the accumulated columns.
   */
  price<P extends FuturesPricePart>(parts: readonly P[]): FuturesBuilder<C | FuturesPriceColumn<P>>;
  price<P extends FuturesPricePart>(
    parts?: readonly P[],
  ): FuturesBuilder<C | FuturesPriceColumn<P>> {
    const columns = partColumns("price", PRICE_COLUMNS, parts);
    return this.#withColumns(columns) as FuturesBuilder<C | FuturesPriceColumn<P>>;
  }

  /** Adds every dollar-volume column. */
  volume(): FuturesBuilder<C | FuturesVolumeColumn<"dollar">>;
  /**
   * Adds every volume column for one metric.
   *
   * @param options - Column options selecting the metric.
   * @returns A new builder typed with the accumulated columns.
   */
  volume<M extends FuturesVolumeMetric>(options: {
    readonly metric: M;
  }): FuturesBuilder<C | FuturesVolumeColumn<M>>;
  /**
   * Adds the given dollar-volume columns.
   *
   * @param parts - Volume components to add; must not be empty.
   * @returns A new builder typed with the accumulated columns.
   */
  volume<P extends FuturesVolumePart>(
    parts: readonly P[],
  ): FuturesBuilder<C | FuturesVolumeColumn<"dollar", P>>;
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
  ): FuturesBuilder<C | FuturesVolumeColumn<M, P>>;
  volume<P extends FuturesVolumePart, M extends FuturesVolumeMetric>(
    partsOrOptions?: readonly P[] | { readonly metric: M },
    metricOptions?: { readonly metric: M },
  ): FuturesBuilder<C | FuturesVolumeColumn<M, P>> {
    const { parts, options } = splitParts("volume", partsOrOptions, metricOptions);
    const columns = metricColumns("volume", VOLUME_COLUMNS, options);
    return this.#withColumns(partColumns("volume", columns, parts)) as FuturesBuilder<
      C | FuturesVolumeColumn<M, P>
    >;
  }

  /** Adds every trade-count column. */
  trades(): FuturesBuilder<C | FuturesTradeColumn>;
  /**
   * Adds the given trade-count columns.
   *
   * @param parts - Trade-count components to add; must not be empty.
   * @returns A new builder typed with the accumulated columns.
   */
  trades<P extends FuturesTradePart>(
    parts: readonly P[],
  ): FuturesBuilder<C | FuturesTradeColumn<P>>;
  trades<P extends FuturesTradePart>(
    parts?: readonly P[],
  ): FuturesBuilder<C | FuturesTradeColumn<P>> {
    const columns = partColumns("trades", TRADE_COLUMNS, parts);
    return this.#withColumns(columns) as FuturesBuilder<C | FuturesTradeColumn<P>>;
  }

  /** Adds every dollar open-interest column. */
  openInterest(): FuturesBuilder<C | FuturesOpenInterestColumn<"dollar">>;
  /**
   * Adds every open-interest column for one metric.
   *
   * @param options - Column options selecting the metric.
   * @returns A new builder typed with the accumulated columns.
   */
  openInterest<M extends FuturesOpenInterestMetric>(options: {
    readonly metric: M;
  }): FuturesBuilder<C | FuturesOpenInterestColumn<M>>;
  /**
   * Adds the given dollar open-interest columns.
   *
   * @param parts - Open-interest components to add; must not be empty.
   * @returns A new builder typed with the accumulated columns.
   */
  openInterest<P extends FuturesOpenInterestPart>(
    parts: readonly P[],
  ): FuturesBuilder<C | FuturesOpenInterestColumn<"dollar", P>>;
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
  ): FuturesBuilder<C | FuturesOpenInterestColumn<M, P>>;
  openInterest<P extends FuturesOpenInterestPart, M extends FuturesOpenInterestMetric>(
    partsOrOptions?: readonly P[] | { readonly metric: M },
    metricOptions?: { readonly metric: M },
  ): FuturesBuilder<C | FuturesOpenInterestColumn<M, P>> {
    const { parts, options } = splitParts("openInterest", partsOrOptions, metricOptions);
    const columns = metricColumns("openInterest", OPEN_INTEREST_COLUMNS, options);
    return this.#withColumns(partColumns("openInterest", columns, parts)) as FuturesBuilder<
      C | FuturesOpenInterestColumn<M, P>
    >;
  }

  /** Adds both funding-rate columns. */
  fundingRate(): FuturesBuilder<C | FuturesFundingRateColumn>;
  /**
   * Adds the given funding-rate columns.
   *
   * @param parts - Funding-rate components to add; must not be empty.
   * @returns A new builder typed with the accumulated columns.
   */
  fundingRate<P extends FuturesFundingRatePart>(
    parts: readonly P[],
  ): FuturesBuilder<C | FuturesFundingRateColumn<P>>;
  fundingRate<P extends FuturesFundingRatePart>(
    parts?: readonly P[],
  ): FuturesBuilder<C | FuturesFundingRateColumn<P>> {
    const columns = partColumns("fundingRate", FUNDING_RATE_COLUMNS, parts);
    return this.#withColumns(columns) as FuturesBuilder<C | FuturesFundingRateColumn<P>>;
  }

  /** Adds the futures premium column. */
  premium(): FuturesBuilder<C | FuturesPremiumColumn> {
    return this.#withColumns([PREMIUM_COLUMN]);
  }

  /** Adds both liquidation-count columns. */
  liquidations(): FuturesBuilder<C | FuturesLiquidationColumn>;
  /**
   * Adds the given liquidation-count columns.
   *
   * @param parts - Liquidation sides to add; must not be empty.
   * @returns A new builder typed with the accumulated columns.
   */
  liquidations<P extends FuturesLiquidationPart>(
    parts: readonly P[],
  ): FuturesBuilder<C | FuturesLiquidationColumn<P>>;
  liquidations<P extends FuturesLiquidationPart>(
    parts?: readonly P[],
  ): FuturesBuilder<C | FuturesLiquidationColumn<P>> {
    const columns = partColumns("liquidations", LIQUIDATION_COLUMNS, parts);
    return this.#withColumns(columns) as FuturesBuilder<C | FuturesLiquidationColumn<P>>;
  }

  /** Adds every dollar liquidation-volume column. */
  liquidationVolume(): FuturesBuilder<C | FuturesLiquidationVolumeColumn<"dollar">>;
  /**
   * Adds every liquidation-volume column for one metric.
   *
   * @param options - Column options selecting the metric.
   * @returns A new builder typed with the accumulated columns.
   */
  liquidationVolume<M extends FuturesLiquidationVolumeMetric>(options: {
    readonly metric: M;
  }): FuturesBuilder<C | FuturesLiquidationVolumeColumn<M>>;
  /**
   * Adds the given dollar liquidation-volume columns.
   *
   * @param parts - Liquidation-volume components to add; must not be empty.
   * @returns A new builder typed with the accumulated columns.
   */
  liquidationVolume<P extends FuturesLiquidationVolumePart>(
    parts: readonly P[],
  ): FuturesBuilder<C | FuturesLiquidationVolumeColumn<"dollar", P>>;
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
  ): FuturesBuilder<C | FuturesLiquidationVolumeColumn<M, P>>;
  liquidationVolume<
    P extends FuturesLiquidationVolumePart,
    M extends FuturesLiquidationVolumeMetric,
  >(
    partsOrOptions?: readonly P[] | { readonly metric: M },
    metricOptions?: { readonly metric: M },
  ): FuturesBuilder<C | FuturesLiquidationVolumeColumn<M, P>> {
    const { parts, options } = splitParts("liquidationVolume", partsOrOptions, metricOptions);
    const columns = metricColumns("liquidationVolume", LIQUIDATION_VOLUME_COLUMNS, options);
    return this.#withColumns(partColumns("liquidationVolume", columns, parts)) as FuturesBuilder<
      C | FuturesLiquidationVolumeColumn<M, P>
    >;
  }

  /**
   * Lowers and validates the chain into raw futures parameters.
   *
   * @param scope - The exchanges, target, time range, and resolution to query.
   * @returns A fresh validated parameter object.
   */
  params(scope: FuturesScope): FuturesStandardParams<C> {
    const lowered: FuturesStandardParams<C> = {
      columns: [...this.#state.columns],
      ...lowerMarketRowsScope(scope, FUTURES_EXCHANGES),
    };
    return FuturesParams.parse(lowered);
  }

  /**
   * Lowers the chain into a lazy query without sending a request.
   *
   * A trailing duration in the scope is fixed when this method is called.
   *
   * @param scope - The exchanges, target, time range, and resolution to query.
   */
  build(scope: FuturesScope): Query<FuturesRow<C>, Data<FuturesExchange, C>> {
    return this.#query.build(this.params(scope));
  }

  /**
   * Builds and immediately fetches the query.
   *
   * @param scope - The exchanges, target, time range, and resolution to query.
   * @param options - Per-request transport options.
   */
  fetch(scope: FuturesScope, options?: HttpRequestOptions): Promise<Data<FuturesExchange, C>> {
    return this.build(scope).execute(options);
  }

  #withColumns<Added extends FuturesStandardColumn>(
    columns: readonly Added[],
  ): FuturesBuilder<C | Added> {
    const accumulated: (C | Added)[] = [...this.#state.columns];
    const seen = new Set<C | Added>(accumulated);
    for (const column of columns) {
      if (seen.has(column)) continue;
      seen.add(column);
      accumulated.push(column);
    }
    return new FuturesBuilder(this.#query, { ...this.#state, columns: accumulated });
  }
}
