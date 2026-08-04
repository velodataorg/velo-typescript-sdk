import type { HttpRequestOptions } from "../../../transport/http.ts";
import type { QueryBuilder, QueryFactory, QueryRequest } from "../../plan.ts";
import { MarketCapsParams } from "./params.ts";
import type { MarketCap } from "./validation.ts";

/** An immutable market-cap history request builder bound to one client. */
export class MarketCapsHistoryBuilder implements QueryBuilder<"marketCaps.history"> {
  readonly #request: QueryRequest<"marketCaps.history">;
  readonly #query: QueryFactory<"marketCaps.history">;

  constructor(params: MarketCapsParams, query: QueryFactory<"marketCaps.history">) {
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
