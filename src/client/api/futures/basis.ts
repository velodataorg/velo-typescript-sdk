import type { HttpRequestOptions } from "../../../transport/http.js";
import {
  betweenTime,
  type BuilderTime,
  lastTime,
  type LastDuration,
  lowerTime,
} from "../../common/builder/time.js";
import type { Data } from "../../common/data/data.js";
import { BASIS_COLUMN } from "../../common/market/columns.js";
import type { FuturesExchange } from "../../common/market/exchanges.js";
import type { Query } from "../../common/query.js";
import type { Resolution } from "../../common/rows/resolution.js";
import { BASIS_COINS, FuturesParams, type BasisCoin, type FuturesBasisParams } from "./params.js";
import { FuturesQuery, type FuturesRow } from "./query.js";

interface State {
  readonly coins?: readonly BasisCoin[];
  readonly time?: BuilderTime;
  readonly resolution?: Resolution;
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

  /** Replaces the time selection with an explicit half-open range. */
  between(begin: number | Date, end: number | Date): FuturesBasisBuilder {
    return this.#with({ time: betweenTime(begin, end) });
  }

  /** Replaces the time selection with a trailing duration. */
  last(duration: LastDuration): FuturesBasisBuilder {
    return this.#with({ time: lastTime(duration) });
  }

  /** Replaces the query resolution. */
  resolution(resolution: Resolution): FuturesBasisBuilder {
    return this.#with({ resolution });
  }

  /** Lowers and validates the chain into raw futures basis parameters. */
  params(): FuturesBasisParams {
    return FuturesParams.parse(this.#lower());
  }

  /** Lowers the chain into a lazy query without sending a request. */
  build(): Query<FuturesRow<typeof BASIS_COLUMN>, Data<FuturesExchange, typeof BASIS_COLUMN>> {
    return this.#query.build(this.#lower());
  }

  /** Lowers and immediately executes the chain. */
  execute(options?: HttpRequestOptions): Promise<Data<FuturesExchange, typeof BASIS_COLUMN>> {
    return this.build().execute(options);
  }

  #with(patch: Partial<State>): FuturesBasisBuilder {
    return new FuturesBasisBuilder(this.#query, { ...this.#state, ...patch });
  }

  #lower(): FuturesBasisParams {
    const resolution =
      this.#state.resolution === undefined ? {} : { resolution: this.#state.resolution };

    /* The parser or raw query immediately validates builders that are still incomplete. */
    return {
      columns: [BASIS_COLUMN],
      coins: [...(this.#state.coins ?? BASIS_COINS)],
      ...lowerTime(this.#state.time),
      ...resolution,
    } as FuturesBasisParams;
  }
}
