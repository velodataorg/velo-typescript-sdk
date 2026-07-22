import { Duration, type DurationUnit } from "luxon";

import type { HttpRequestOptions } from "../../../transport/http.js";
import { assert } from "../../../util/assert.js";
import type { Data } from "../../common/data/data.js";
import type { FuturesStandardColumn } from "../../common/market/columns.js";
import { FUTURES_EXCHANGES, type FuturesExchange } from "../../common/market/exchanges.js";
import type { Query } from "../../common/query.js";
import type { Resolution } from "../../common/rows/resolution.js";
import { FuturesParams, type FuturesStandardParams } from "./params.js";
import { FuturesQuery, type FuturesRow } from "./query.js";
import {
  FUTURES_SELECTOR_COLUMNS,
  type FuturesOpenInterestColumn,
  type FuturesOpenInterestMetric,
  type FuturesOpenInterestPart,
  type FuturesPriceColumn,
  type FuturesPricePart,
} from "./selectors.js";

export type {
  FuturesOpenInterestMetric,
  FuturesOpenInterestPart,
  FuturesPricePart,
} from "./selectors.js";

const { price: PRICE_COLUMNS, openInterest: OPEN_INTEREST_COLUMNS } = FUTURES_SELECTOR_COLUMNS;

const LAST_UNITS = {
  m: "minutes",
  h: "hours",
  D: "days",
  W: "weeks",
} as const satisfies Record<string, DurationUnit>;

/** A positive whole-number duration in minutes, hours, days, or weeks. */
export type LastDuration = `${number}${keyof typeof LAST_UNITS}`;

const LAST_PATTERN = /^(\d+)(m|h|D|W)$/;

interface State {
  readonly columns: readonly FuturesStandardColumn[];
  readonly exchanges?: readonly FuturesExchange[];
  readonly selection?:
    | { readonly kind: "products"; readonly values: readonly string[] }
    | { readonly kind: "coins"; readonly values: readonly string[] };
  readonly time?:
    | { readonly kind: "between"; readonly begin: number; readonly end: number }
    | { readonly kind: "last"; readonly milliseconds: number };
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

  /**
   * Adds one or more OHLC price columns.
   *
   * @param parts - Price components to add; defaults to all components when omitted.
   * @returns A new builder typed with the accumulated columns.
   */
  price<P extends FuturesPricePart = FuturesPricePart>(
    ...parts: readonly P[]
  ): FuturesBuilder<C | FuturesPriceColumn<P>> {
    const columns =
      parts.length === 0 ? Object.values(PRICE_COLUMNS) : parts.map((part) => PRICE_COLUMNS[part]);
    return this.#withColumns(columns) as FuturesBuilder<C | FuturesPriceColumn<P>>;
  }

  /**
   * Adds one open-interest column, or every open-interest column when the
   * part is omitted.
   *
   * @param part - Open-interest component to add; defaults to all components when omitted.
   * @param options - Column options; the metric defaults to `"dollar"`.
   * @returns A new builder typed with the accumulated columns.
   */
  openInterest<
    P extends FuturesOpenInterestPart = FuturesOpenInterestPart,
    M extends FuturesOpenInterestMetric = "dollar",
  >(
    part?: P,
    options?: { readonly metric: M },
  ): FuturesBuilder<C | FuturesOpenInterestColumn<M, P>> {
    const metric = options?.metric ?? "dollar";
    const columns = OPEN_INTEREST_COLUMNS[metric];
    const selected = part === undefined ? Object.values(columns) : [columns[part]];
    return this.#withColumns(selected) as FuturesBuilder<C | FuturesOpenInterestColumn<M, P>>;
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
    return this.#with({
      time: {
        kind: "between",
        begin: FuturesBuilder.#timestamp(begin),
        end: FuturesBuilder.#timestamp(end),
      },
    });
  }

  /**
   * Replaces the time selection with a trailing duration.
   *
   * The current time is read by {@link FuturesBuilder.params | params()},
   * {@link FuturesBuilder.build | build()}, or
   * {@link FuturesBuilder.execute | execute()}, rather than by this method.
   */
  last(duration: LastDuration): FuturesBuilder<C> {
    return this.#with({
      time: { kind: "last", milliseconds: FuturesBuilder.#duration(duration) },
    });
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

    const selectedTime = this.#state.time;
    let time: Partial<{ readonly begin: number; readonly end: number }> = {};
    if (selectedTime?.kind === "between") {
      time = { begin: selectedTime.begin, end: selectedTime.end };
    } else if (selectedTime?.kind === "last") {
      const end = Date.now();
      time = { begin: end - selectedTime.milliseconds, end };
    }

    const resolution =
      this.#state.resolution === undefined ? {} : { resolution: this.#state.resolution };

    /* The parser or raw query immediately validates builders that are still incomplete. */
    return {
      exchanges: [...(this.#state.exchanges ?? FUTURES_EXCHANGES)],
      columns: [...this.#state.columns] as C[],
      ...target,
      ...time,
      ...resolution,
    } as unknown as FuturesStandardParams<C>;
  }

  static #duration(duration: LastDuration): number {
    const match = LAST_PATTERN.exec(duration);
    assert(
      match !== null,
      `Invalid last duration ${JSON.stringify(duration)}: expected a positive integer followed by m, h, D, or W`,
    );
    const count = Number(match[1]);
    assert(
      count > 0 && Number.isSafeInteger(count),
      `Invalid last duration ${JSON.stringify(duration)}: expected a positive safe duration`,
    );
    const unit = LAST_UNITS[match[2] as keyof typeof LAST_UNITS];
    const milliseconds = Duration.fromObject({ [unit]: count }).toMillis();
    assert(
      Number.isSafeInteger(milliseconds),
      `Invalid last duration ${JSON.stringify(duration)}: expected a positive safe duration`,
    );
    return milliseconds;
  }

  static #timestamp(value: number | Date): number {
    return value instanceof Date ? value.getTime() : value;
  }
}
