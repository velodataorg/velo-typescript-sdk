import type { Http } from "../../../transport/http.js";
import { FuturesCatalogQuery } from "./futures-catalog-query.js";
import { OptionsCatalogQuery } from "./options-catalog-query.js";
import { SpotCatalogQuery } from "./spot-catalog-query.js";

/** The product-catalog namespace exposed by {@link Velo}. */
export class Catalog {
  readonly futures: FuturesCatalogQuery["build"];
  readonly options: OptionsCatalogQuery["build"];
  readonly spot: SpotCatalogQuery["build"];

  constructor(http: Http) {
    const futures = new FuturesCatalogQuery(http);
    const options = new OptionsCatalogQuery(http);
    const spot = new SpotCatalogQuery(http);
    this.futures = futures.build.bind(futures);
    this.options = options.build.bind(options);
    this.spot = spot.build.bind(spot);
  }
}
