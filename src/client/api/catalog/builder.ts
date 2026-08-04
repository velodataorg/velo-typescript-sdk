import type { QueryBuilder, QueryParams, QueryRequest } from "../../query/plan.ts";
import { type FuturesCatalogParams, prepareFuturesCatalogParams } from "./futures.ts";
import { type OptionsCatalogParams, prepareOptionsCatalogParams } from "./options.ts";
import { prepareSpotCatalogParams, type SpotCatalogParams } from "./spot.ts";

type CatalogKind = "catalog.futures" | "catalog.options" | "catalog.spot";

class CatalogBuilder<K extends CatalogKind, P extends QueryParams<K>> implements QueryBuilder<
  K,
  P
> {
  readonly #request: QueryRequest<K, P>;

  constructor(kind: K, params: P, validate: (params: P) => unknown) {
    validate(params);
    const snapshot = Object.freeze(structuredClone(params)) as P;
    this.#request = Object.freeze({ kind, params: snapshot }) as QueryRequest<K, P>;
  }

  /** Returns the immutable transport-independent endpoint request. */
  build(): QueryRequest<K, P> {
    return this.#request;
  }
}

/** An immutable futures catalog request builder. */
export class FuturesCatalogBuilder extends CatalogBuilder<"catalog.futures", FuturesCatalogParams> {
  constructor(params?: FuturesCatalogParams) {
    super("catalog.futures", params === undefined ? {} : params, prepareFuturesCatalogParams);
  }
}

/** An immutable options catalog request builder. */
export class OptionsCatalogBuilder extends CatalogBuilder<"catalog.options", OptionsCatalogParams> {
  constructor(params?: OptionsCatalogParams) {
    super("catalog.options", params === undefined ? {} : params, prepareOptionsCatalogParams);
  }
}

/** An immutable spot catalog request builder. */
export class SpotCatalogBuilder extends CatalogBuilder<"catalog.spot", SpotCatalogParams> {
  constructor(params?: SpotCatalogParams) {
    super("catalog.spot", params === undefined ? {} : params, prepareSpotCatalogParams);
  }
}
