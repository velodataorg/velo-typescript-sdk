import { MarketCapsHistoryBuilder } from "./builder.ts";
import type { MarketCapsParams } from "./params.ts";

/** The market-caps namespace exposed by {@link Velo}. */
export class MarketCaps {
  /** Creates an immutable market-cap history request builder. */
  history(params: MarketCapsParams): MarketCapsHistoryBuilder {
    return new MarketCapsHistoryBuilder(params);
  }
}
