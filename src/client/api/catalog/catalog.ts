import { FuturesCatalogBuilder, OptionsCatalogBuilder, SpotCatalogBuilder } from "./builder.ts";
import type { FuturesCatalogParams } from "./futures.ts";
import type { OptionsCatalogParams } from "./options.ts";
import type { SpotCatalogParams } from "./spot.ts";

/** The product-catalog namespace exposed by {@link Velo}. */
export class Catalog {
  /** Creates an immutable futures catalog request builder. */
  futures(params: FuturesCatalogParams = {}): FuturesCatalogBuilder {
    return new FuturesCatalogBuilder(params);
  }

  /** Creates an immutable options catalog request builder. */
  options(params: OptionsCatalogParams = {}): OptionsCatalogBuilder {
    return new OptionsCatalogBuilder(params);
  }

  /** Creates an immutable spot catalog request builder. */
  spot(params: SpotCatalogParams = {}): SpotCatalogBuilder {
    return new SpotCatalogBuilder(params);
  }
}
