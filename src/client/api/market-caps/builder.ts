import type { HttpRequestOptions } from "../../../transport/http.ts";
import type { Query } from "../../common/query.ts";
import type { QueryBuilder, QueryRequest } from "../../plan.ts";
import { MarketCapsParams } from "./params.ts";
import type { MarketCap } from "./validation.ts";

/** Binds a market-cap history request to the central lazy-query constructor. */
export type MarketCapsQueryFactory = (
  request: QueryRequest<"marketCaps.history">,
) => Query<MarketCap, MarketCap[]>;

/** An immutable market-cap history request builder bound to one client. */
export class MarketCapsHistoryBuilder implements QueryBuilder<"marketCaps.history"> {
  readonly #request: QueryRequest<"marketCaps.history">;
  readonly #query: MarketCapsQueryFactory;

  constructor(params: MarketCapsParams, query: MarketCapsQueryFactory) {
    const snapshot = MarketCapsParams.parse(params);
    Object.freeze(snapshot.coins);
    Object.freeze(snapshot);
    this.#request = Object.freeze({ kind: "marketCaps.history", params: snapshot });
    this.#query = query;
  }

  /** Returns the immutable transport-independent endpoint request. */
  build(): QueryRequest<"marketCaps.history"> {
    return this.#request;
  }

  /** Creates and immediately executes a lazy query through the bound client. */
  fetch(options?: HttpRequestOptions): Promise<MarketCap[]> {
    return this.#query(this.#request).execute(options);
  }

  /** Creates a lazy query and streams market caps through the bound client. */
  stream(options?: HttpRequestOptions): AsyncIterable<MarketCap> {
    return this.#query(this.#request).stream(options);
  }
}
