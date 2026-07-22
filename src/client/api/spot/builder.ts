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
import type { SpotColumn } from "../../common/market/columns.js";
import { SPOT_EXCHANGES, type SpotExchange } from "../../common/market/exchanges.js";
import type { Query } from "../../common/query.js";
import type { Resolution } from "../../common/rows/resolution.js";
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

interface State {
  readonly columns: readonly SpotColumn[];
  readonly exchanges?: readonly SpotExchange[];
  readonly selection?:
    | { readonly kind: "products"; readonly values: readonly string[] }
    | { readonly kind: "coins"; readonly values: readonly string[] };
  readonly time?: BuilderTime;
  readonly resolution?: Resolution;
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
  readonly #state: State;

  constructor(query: SpotQuery, state: State = { columns: [] }) {
    this.#query = query;
    this.#state = state;
  }

  /**
   * Adds one or more OHLC price columns.
   *
   * @param parts - Price components to add; defaults to all components when omitted.
   * @returns A new builder typed with the accumulated columns.
   */
  price<P extends SpotPricePart = SpotPricePart>(
    ...parts: readonly P[]
  ): SpotBuilder<C | SpotPriceColumn<P>> {
    const columns =
      parts.length === 0 ? Object.values(PRICE_COLUMNS) : parts.map((part) => PRICE_COLUMNS[part]);
    return this.#withColumns(columns) as SpotBuilder<C | SpotPriceColumn<P>>;
  }

  /**
   * Adds one volume column, or every volume component for one metric when the
   * part is omitted.
   *
   * @param part - Volume component to add; defaults to all components when omitted.
   * @param options - Column options; the metric defaults to `"dollar"`.
   * @returns A new builder typed with the accumulated columns.
   */
  volume<P extends SpotVolumePart = SpotVolumePart, M extends SpotVolumeMetric = "dollar">(
    part?: P,
    options?: { readonly metric: M },
  ): SpotBuilder<C | SpotVolumeColumn<M, P>> {
    const metric = options?.metric ?? "dollar";
    const columns = VOLUME_COLUMNS[metric];
    const selected = part === undefined ? Object.values(columns) : [columns[part]];
    return this.#withColumns(selected) as SpotBuilder<C | SpotVolumeColumn<M, P>>;
  }

  /**
   * Adds one trade-count column, or every trade-count column when the part is omitted.
   *
   * @param part - Trade-count component to add; defaults to all components when omitted.
   * @returns A new builder typed with the accumulated columns.
   */
  trades<P extends SpotTradePart = SpotTradePart>(part?: P): SpotBuilder<C | SpotTradeColumn<P>> {
    const columns = part === undefined ? Object.values(TRADE_COLUMNS) : [TRADE_COLUMNS[part]];
    return this.#withColumns(columns) as SpotBuilder<C | SpotTradeColumn<P>>;
  }

  /**
   * Replaces the exchanges selected by the chain.
   *
   * When omitted, all spot exchanges are queried.
   */
  exchanges(exchanges: readonly SpotExchange[]): SpotBuilder<C> {
    return this.#with({ exchanges: [...exchanges] });
  }

  /**
   * Replaces the products selected by the chain.
   *
   * @throws {@link VeloError} when coins have already been selected.
   */
  products(products: readonly string[]): SpotBuilder<C> {
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
  coins(coins: readonly string[]): SpotBuilder<C> {
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
  between(begin: number | Date, end: number | Date): SpotBuilder<C> {
    return this.#with({ time: betweenTime(begin, end) });
  }

  /**
   * Replaces the time selection with a trailing duration.
   *
   * The current time is read by {@link SpotBuilder.params | params()},
   * {@link SpotBuilder.build | build()}, or
   * {@link SpotBuilder.execute | execute()}, rather than by this method.
   */
  last(duration: LastDuration): SpotBuilder<C> {
    return this.#with({ time: lastTime(duration) });
  }

  /** Replaces the query resolution. */
  resolution(resolution: Resolution): SpotBuilder<C> {
    return this.#with({ resolution });
  }

  /**
   * Lowers and validates the chain into raw spot parameters.
   *
   * @returns A fresh validated parameter object.
   */
  params(): SpotParams<C> {
    return SpotParams.parse(this.#lower());
  }

  /**
   * Lowers the chain into a lazy query without sending a request.
   *
   * A trailing duration is fixed when this method is called.
   */
  build(): Query<SpotRow<C>, Data<SpotExchange, C>> {
    return this.#query.build(this.#lower());
  }

  /**
   * Lowers and immediately executes the chain.
   *
   * @param options - Per-request transport options.
   */
  execute(options?: HttpRequestOptions): Promise<Data<SpotExchange, C>> {
    return this.build().execute(options);
  }

  #with(patch: Partial<State>): SpotBuilder<C> {
    return new SpotBuilder(this.#query, { ...this.#state, ...patch });
  }

  #withColumns<Added extends SpotColumn>(columns: readonly Added[]): SpotBuilder<C | Added> {
    const accumulated = [...this.#state.columns];
    const seen = new Set(accumulated);
    for (const column of columns) {
      if (seen.has(column)) continue;
      seen.add(column);
      accumulated.push(column);
    }
    return new SpotBuilder(this.#query, { ...this.#state, columns: accumulated });
  }

  #lower(): SpotParams<C> {
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
      exchanges: [...(this.#state.exchanges ?? SPOT_EXCHANGES)],
      columns: [...this.#state.columns] as C[],
      ...target,
      ...lowerTime(this.#state.time),
      ...resolution,
    } as unknown as SpotParams<C>;
  }
}
