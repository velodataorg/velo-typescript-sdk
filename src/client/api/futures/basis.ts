import type { HttpRequestOptions } from "../../../transport/http.ts";
import {
  type BuilderWindow,
  lowerBuilderWindow,
  snapshotBuilderWindow,
  type WindowScope,
} from "../../common/builder/scope.ts";
import type { ScopeBuilderStep, ScopedBuilder } from "../../common/builder/scoped.ts";
import type { DataResult } from "../../common/data/data.ts";
import { BASIS_COLUMN } from "../../common/market/columns.ts";
import type { FuturesExchange } from "../../common/market/exchanges.ts";
import type { Query } from "../../common/query.ts";
import type { QueryRequest } from "../../plan.ts";
import {
  BASIS_COINS,
  type BasisCoin,
  FuturesBasisParams,
  type FuturesBasisParams as FuturesBasisParamsType,
  type FuturesRow,
} from "./params.ts";

/** The required time scope configured by a basis builder's `over()` step. */
export type FuturesBasisScope = WindowScope;

interface State {
  readonly coins?: readonly BasisCoin[];
  readonly window?: BuilderWindow;
}

/** Binds a futures basis request to the central lazy-query constructor. */
export type FuturesBasisQueryFactory = (
  request: QueryRequest<"futures.basis", FuturesBasisParamsType>,
) => Query<FuturesRow<typeof BASIS_COLUMN>, DataResult<FuturesExchange, typeof BASIS_COLUMN>>;

/** An immutable fluent request builder for the annualized three-month futures basis. */
export class FuturesBasisBuilder<S extends ScopeBuilderStep = never> {
  readonly #query: FuturesBasisQueryFactory;
  readonly #state: State;

  constructor(query: FuturesBasisQueryFactory, state: State = {}) {
    this.#query = query;
    this.#state = state;
  }

  /** Replaces the selected basis coins. Defaults to both BTC and ETH. */
  coins(coins: readonly BasisCoin[]): FuturesBasisBuilder<S> {
    return new FuturesBasisBuilder<S>(this.#query, { ...this.#state, coins: [...coins] });
  }

  /** Replaces the time window and resolution selected by the chain. */
  over(scope: FuturesBasisScope): FuturesBasisBuilder<S | "over"> {
    return new FuturesBasisBuilder<S | "over">(this.#query, {
      ...this.#state,
      window: snapshotBuilderWindow(scope),
    });
  }

  /** Lowers and validates the chain into fresh futures basis parameters. */
  params(this: ScopedBuilder<FuturesBasisBuilder<S>, S, "over">): FuturesBasisParamsType {
    return this.#params();
  }

  /** Lowers the chain into an immutable transport-independent request. */
  build(
    this: ScopedBuilder<FuturesBasisBuilder<S>, S, "over">,
    ...ready: "over" extends S ? [] : [never]
  ): QueryRequest<"futures.basis", FuturesBasisParamsType> {
    void ready;
    return this.#build();
  }

  /** Builds the request and immediately fetches its basis query. */
  fetch(
    this: ScopedBuilder<FuturesBasisBuilder<S>, S, "over">,
    options?: HttpRequestOptions,
  ): Promise<DataResult<FuturesExchange, typeof BASIS_COLUMN>> {
    return this.#query(this.#build()).execute(options);
  }

  /** Builds and streams decoded basis rows without collecting them. */
  stream(
    this: ScopedBuilder<FuturesBasisBuilder<S>, S, "over">,
    options?: HttpRequestOptions,
  ): AsyncIterable<FuturesRow<typeof BASIS_COLUMN>> {
    return this.#query(this.#build()).stream(options);
  }

  #params(): FuturesBasisParamsType {
    const lowered: FuturesBasisParamsType = {
      columns: [BASIS_COLUMN],
      coins: [...(this.#state.coins ?? BASIS_COINS)],
      ...lowerBuilderWindow(this.#state.window),
    };
    return FuturesBasisParams.parse(lowered);
  }

  #build(): QueryRequest<"futures.basis", FuturesBasisParamsType> {
    const params = this.#params();
    Object.freeze(params.columns);
    Object.freeze(params.coins);
    Object.freeze(params);
    return Object.freeze({ kind: "futures.basis", params });
  }
}
