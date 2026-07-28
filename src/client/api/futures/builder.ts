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
import type { FuturesStandardColumn } from "../../common/market/columns.js";
import { FUTURES_EXCHANGES, type FuturesExchange } from "../../common/market/exchanges.js";
import type { Query } from "../../common/query.js";
import type { Resolution } from "../../common/rows/resolution.js";
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

interface State {
  readonly columns: readonly FuturesStandardColumn[];
  readonly exchanges?: readonly FuturesExchange[];
  readonly selection?:
    | { readonly kind: "products"; readonly values: readonly string[] }
    | { readonly kind: "coins"; readonly values: readonly string[] };
  readonly time?: BuilderTime;
  readonly resolution?: Resolution;
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
  readonly #state: State;

  constructor(query: FuturesQuery, state: State = { columns: [] }) {
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
   * Replaces the exchanges selected by the chain.
   *
   * When omitted, all futures exchanges are queried.
   */
  exchanges(exchanges: readonly FuturesExchange[]): FuturesBuilder<C> {
    return this.#with({ exchanges: [...exchanges] });
  }

  /**
   * Replaces the products selected by the chain.
   *
   * @throws {@link VeloError} when coins have already been selected.
   */
  products(products: readonly string[]): FuturesBuilder<C> {
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
  coins(coins: readonly string[]): FuturesBuilder<C> {
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
  between(begin: number | Date, end: number | Date): FuturesBuilder<C> {
    return this.#with({ time: betweenTime(begin, end) });
  }

  /**
   * Replaces the time selection with a trailing duration.
   *
   * The current time is read by {@link FuturesBuilder.params | params()},
   * {@link FuturesBuilder.build | build()}, or
   * {@link FuturesBuilder.execute | execute()}, rather than by this method.
   */
  last(duration: LastDuration): FuturesBuilder<C> {
    return this.#with({ time: lastTime(duration) });
  }

  /** Replaces the query resolution. */
  resolution(resolution: Resolution): FuturesBuilder<C> {
    return this.#with({ resolution });
  }

  /**
   * Lowers and validates the chain into raw futures parameters.
   *
   * @returns A fresh validated parameter object.
   */
  params(): FuturesStandardParams<C> {
    return FuturesParams.parse(this.#lower());
  }

  /**
   * Lowers the chain into a lazy query without sending a request.
   *
   * A trailing duration is fixed when this method is called.
   */
  build(): Query<FuturesRow<C>, Data<FuturesExchange, C>> {
    return this.#query.build(this.#lower());
  }

  /**
   * Lowers and immediately executes the chain.
   *
   * @param options - Per-request transport options.
   */
  execute(options?: HttpRequestOptions): Promise<Data<FuturesExchange, C>> {
    return this.build().execute(options);
  }

  #with(patch: Partial<State>): FuturesBuilder<C> {
    return new FuturesBuilder(this.#query, { ...this.#state, ...patch });
  }

  #withColumns<Added extends FuturesStandardColumn>(
    columns: readonly Added[],
  ): FuturesBuilder<C | Added> {
    const accumulated = [...this.#state.columns];
    const seen = new Set(accumulated);
    for (const column of columns) {
      if (seen.has(column)) continue;
      seen.add(column);
      accumulated.push(column);
    }
    return new FuturesBuilder(this.#query, { ...this.#state, columns: accumulated });
  }

  #lower(): FuturesStandardParams<C> {
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
      exchanges: [...(this.#state.exchanges ?? FUTURES_EXCHANGES)],
      columns: [...this.#state.columns] as C[],
      ...target,
      ...lowerTime(this.#state.time),
      ...resolution,
    } as unknown as FuturesStandardParams<C>;
  }
}
