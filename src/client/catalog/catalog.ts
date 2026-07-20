import type { Http } from "../../transport/http.js";
import { createFuturesCatalog } from "./futures.js";
import type { FuturesCatalog } from "./futures.js";
import { createOptionsCatalog } from "./options.js";
import type { OptionsCatalog } from "./options.js";
import { createSpotCatalog } from "./spot.js";
import type { SpotCatalog } from "./spot.js";

export type { FutureProduct, FuturesCatalogParams } from "./futures.js";
export type { OptionProduct, OptionsCatalogParams } from "./options.js";
export type { CatalogParams } from "./params.js";
export type { SpotCatalogParams, SpotProduct } from "./spot.js";

export interface Catalog {
  readonly futures: FuturesCatalog;
  readonly spot: SpotCatalog;
  readonly options: OptionsCatalog;
}

/**
 * Creates the stable product-catalog namespace.
 */
export function createCatalog(http: Http): Catalog {
  return {
    futures: createFuturesCatalog(http),
    spot: createSpotCatalog(http),
    options: createOptionsCatalog(http),
  };
}
