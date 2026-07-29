import type { HttpRequestOptions } from "../../../transport/http.js";
import { assert } from "../../../util/assert.js";
import { lowerTimeScope, type TimeScope } from "../../common/builder/scope.js";
import type { Data } from "../../common/data/data.js";
import { BASIS_COLUMN } from "../../common/market/columns.js";
import type { FuturesExchange } from "../../common/market/exchanges.js";
import type { Query } from "../../common/query.js";
import type { Resolution } from "../../common/rows/resolution.js";
import { BASIS_COINS, FuturesParams, type BasisCoin, type FuturesBasisParams } from "./params.js";
import { FuturesQuery, type FuturesRow } from "./query.js";

/**
 * The required query scope accepted by a basis builder's terminal methods.
 *
 * Coins stay a chain method because they default to both BTC and ETH.
 */
export type FuturesBasisScope = TimeScope & { readonly resolution: Resolution };

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
    assert(scope.resolution !== undefined, "scope must set a resolution");
    const lowered: FuturesBasisParams = {
      columns: [BASIS_COLUMN],
      coins: [...(this.#state.coins ?? BASIS_COINS)],
      ...lowerTimeScope(scope),
      resolution: scope.resolution,
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
  ): Query<FuturesRow<typeof BASIS_COLUMN>, Data<FuturesExchange, typeof BASIS_COLUMN>> {
    return this.#query.build(this.params(scope));
  }

  /**
   * Lowers and immediately executes the chain.
   *
   * @param scope - The time range and resolution to query.
   * @param options - Per-request transport options.
   */
  execute(
    scope: FuturesBasisScope,
    options?: HttpRequestOptions,
  ): Promise<Data<FuturesExchange, typeof BASIS_COLUMN>> {
    return this.build(scope).execute(options);
  }

  #with(patch: Partial<State>): FuturesBasisBuilder {
    return new FuturesBasisBuilder(this.#query, { ...this.#state, ...patch });
  }
}
