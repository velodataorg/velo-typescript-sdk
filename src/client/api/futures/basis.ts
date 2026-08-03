import type { HttpRequestOptions } from "../../../transport/http.ts";
import { lowerTimedScope, type TimedScope } from "../../common/builder/scope.ts";
import type { DataResult } from "../../common/data/data.ts";
import { BASIS_COLUMN } from "../../common/market/columns.ts";
import type { FuturesExchange } from "../../common/market/exchanges.ts";
import type { Query } from "../../common/query.ts";
import { BASIS_COINS, FuturesParams, type BasisCoin, type FuturesBasisParams } from "./params.ts";
import { FuturesQuery, type FuturesRow } from "./query.ts";

/**
 * The required query scope accepted by a basis builder's terminal methods.
 *
 * Coins stay a chain method because they default to both BTC and ETH.
 */
export type FuturesBasisScope = TimedScope;

interface State {
  readonly coins?: readonly BasisCoin[];
}

/** An immutable fluent query for the annualized three-month futures basis. */
export class FuturesBasisBuilder {
  readonly #query: FuturesQuery;
  readonly #state: State;

  constructor(query: FuturesQuery, state: State = {}) {
    this.#query = query;
    this.#state = state;
  }

  /** Replaces the selected basis coins. Defaults to both BTC and ETH. */
  coins(coins: readonly BasisCoin[]): FuturesBasisBuilder {
    return this.#with({ coins: [...coins] });
  }

  /**
   * Lowers and validates the chain into raw futures basis parameters.
   *
   * @param scope - The time range and resolution to query.
   */
  params(scope: FuturesBasisScope): FuturesBasisParams {
    const lowered: FuturesBasisParams = {
      columns: [BASIS_COLUMN],
      coins: [...(this.#state.coins ?? BASIS_COINS)],
      ...lowerTimedScope(scope),
    };
    return FuturesParams.parse(lowered);
  }

  /**
   * Lowers the chain into a lazy query without sending a request.
   *
   * A trailing duration in the scope is fixed when this method is called.
   *
   * @param scope - The time range and resolution to query.
   */
  build(
    scope: FuturesBasisScope,
  ): Query<FuturesRow<typeof BASIS_COLUMN>, DataResult<FuturesExchange, typeof BASIS_COLUMN>> {
    return this.#query.build(this.params(scope));
  }

  /**
   * Builds and immediately fetches the query.
   *
   * @param scope - The time range and resolution to query.
   * @param options - Per-request transport options.
   */
  fetch(
    scope: FuturesBasisScope,
    options?: HttpRequestOptions,
  ): Promise<DataResult<FuturesExchange, typeof BASIS_COLUMN>> {
    return this.build(scope).execute(options);
  }

  #with(patch: Partial<State>): FuturesBasisBuilder {
    return new FuturesBasisBuilder(this.#query, { ...this.#state, ...patch });
  }
}
