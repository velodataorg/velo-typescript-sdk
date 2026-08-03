import type { Http } from "../../../transport/http.ts";
import { FuturesCatalogQuery } from "./futures.ts";
import { OptionsCatalogQuery } from "./options.ts";
import { SpotCatalogQuery } from "./spot.ts";

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
