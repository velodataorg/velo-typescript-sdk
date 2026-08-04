import { MarketCapsHistoryBuilder, type MarketCapsQueryFactory } from "./builder.ts";
import type { MarketCapsParams } from "./params.ts";

/** The market-caps namespace exposed by {@link Velo}. */
export class MarketCaps {
  readonly #query: MarketCapsQueryFactory;

  constructor(query: MarketCapsQueryFactory) {
    this.#query = query;
  }

  /** Creates an immutable market-cap history builder bound to this client. */
  history(params: MarketCapsParams): MarketCapsHistoryBuilder {
    return new MarketCapsHistoryBuilder(params, this.#query);
  }
}
