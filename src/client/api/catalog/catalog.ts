import {
  FuturesCatalogBuilder,
  type FuturesCatalogQueryFactory,
  OptionsCatalogBuilder,
  type OptionsCatalogQueryFactory,
  SpotCatalogBuilder,
  type SpotCatalogQueryFactory,
} from "./builder.ts";
import type { FuturesCatalogParams } from "./futures.ts";
import type { OptionsCatalogParams } from "./options.ts";
import type { SpotCatalogParams } from "./spot.ts";

/** The product-catalog namespace exposed by {@link Velo}. */
export class Catalog {
  readonly #futuresQuery: FuturesCatalogQueryFactory;
  readonly #optionsQuery: OptionsCatalogQueryFactory;
  readonly #spotQuery: SpotCatalogQueryFactory;

  constructor(
    futuresQuery: FuturesCatalogQueryFactory,
    optionsQuery: OptionsCatalogQueryFactory,
    spotQuery: SpotCatalogQueryFactory,
  ) {
    this.#futuresQuery = futuresQuery;
    this.#optionsQuery = optionsQuery;
    this.#spotQuery = spotQuery;
  }

  /** Creates an immutable futures catalog builder bound to this client. */
  futures(params: FuturesCatalogParams = {}): FuturesCatalogBuilder {
    return new FuturesCatalogBuilder(params, this.#futuresQuery);
  }

  /** Creates an immutable options catalog builder bound to this client. */
  options(params: OptionsCatalogParams = {}): OptionsCatalogBuilder {
    return new OptionsCatalogBuilder(params, this.#optionsQuery);
  }

  /** Creates an immutable spot catalog builder bound to this client. */
  spot(params: SpotCatalogParams = {}): SpotCatalogBuilder {
    return new SpotCatalogBuilder(params, this.#spotQuery);
  }
}
