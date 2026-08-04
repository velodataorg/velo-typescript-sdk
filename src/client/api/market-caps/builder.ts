import type { QueryBuilder, QueryRequest } from "../../plan.ts";
import { MarketCapsParams } from "./params.ts";

/** An immutable market-cap history request builder. */
export class MarketCapsHistoryBuilder implements QueryBuilder<"marketCaps.history"> {
  readonly #request: QueryRequest<"marketCaps.history">;

  constructor(params: MarketCapsParams) {
    const snapshot = MarketCapsParams.parse(params);
    Object.freeze(snapshot.coins);
    Object.freeze(snapshot);
    this.#request = Object.freeze({ kind: "marketCaps.history", params: snapshot });
  }

  /** Returns the immutable transport-independent endpoint request. */
  build(): QueryRequest<"marketCaps.history"> {
    return this.#request;
  }
}
