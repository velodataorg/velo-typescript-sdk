import type { QueryFactory } from "../../plan.ts";
import { MarketCapsHistoryBuilder } from "./builder.ts";
import type { MarketCapsParams } from "./params.ts";

/** The market-caps namespace exposed by {@link Velo}. */
export class MarketCaps {
  readonly #query: QueryFactory<"marketCaps.history">;

  constructor(query: QueryFactory<"marketCaps.history">) {
    this.#query = query;
  }

  /** Creates an immutable market-cap history builder bound to this client. */
  history(params: MarketCapsParams): MarketCapsHistoryBuilder {
    return new MarketCapsHistoryBuilder(params, this.#query);
  }
}
