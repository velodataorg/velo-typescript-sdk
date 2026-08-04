import type { HttpRequestOptions } from "../../../transport/http.ts";
import type { Query } from "../../common/query.ts";
import type { QueryBuilder, QueryParams, QueryRequest } from "../../plan.ts";
import {
  type FutureProduct,
  type FuturesCatalogParams,
  prepareFuturesCatalogParams,
} from "./futures.ts";
import {
  type OptionProduct,
  type OptionsCatalogParams,
  prepareOptionsCatalogParams,
} from "./options.ts";
import { prepareSpotCatalogParams, type SpotCatalogParams, type SpotProduct } from "./spot.ts";

type CatalogKind = "catalog.futures" | "catalog.options" | "catalog.spot";

type CatalogQueryFactory<K extends CatalogKind, P extends QueryParams<K>, T> = (
  request: QueryRequest<K, P>,
) => Query<T, T[]>;

class CatalogBuilder<K extends CatalogKind, P extends QueryParams<K>, T> implements QueryBuilder<
  K,
  P
> {
  readonly #request: QueryRequest<K, P>;
  readonly #query: CatalogQueryFactory<K, P, T>;

  constructor(
    kind: K,
    params: P,
    validate: (params: P) => unknown,
    query: CatalogQueryFactory<K, P, T>,
  ) {
    validate(params);
    const snapshot = Object.freeze(structuredClone(params)) as P;
    this.#request = Object.freeze({ kind, params: snapshot }) as QueryRequest<K, P>;
    this.#query = query;
  }

  /** Returns the immutable transport-independent endpoint request. */
  build(): QueryRequest<K, P> {
    return this.#request;
  }

  /** Creates and immediately executes a lazy query through the bound client. */
  fetch(options?: HttpRequestOptions): Promise<T[]> {
    return this.#query(this.#request).execute(options);
  }

  /** Creates a lazy query and streams products through the bound client. */
  stream(options?: HttpRequestOptions): AsyncIterable<T> {
    return this.#query(this.#request).stream(options);
  }
}

export type FuturesCatalogQueryFactory = CatalogQueryFactory<
  "catalog.futures",
  FuturesCatalogParams,
  FutureProduct
>;

/** An immutable futures catalog request builder bound to one client. */
export class FuturesCatalogBuilder extends CatalogBuilder<
  "catalog.futures",
  FuturesCatalogParams,
  FutureProduct
> {
  constructor(params: FuturesCatalogParams, query: FuturesCatalogQueryFactory) {
    super("catalog.futures", params, prepareFuturesCatalogParams, query);
  }
}

export type OptionsCatalogQueryFactory = CatalogQueryFactory<
  "catalog.options",
  OptionsCatalogParams,
  OptionProduct
>;

/** An immutable options catalog request builder bound to one client. */
export class OptionsCatalogBuilder extends CatalogBuilder<
  "catalog.options",
  OptionsCatalogParams,
  OptionProduct
> {
  constructor(params: OptionsCatalogParams, query: OptionsCatalogQueryFactory) {
    super("catalog.options", params, prepareOptionsCatalogParams, query);
  }
}

export type SpotCatalogQueryFactory = CatalogQueryFactory<
  "catalog.spot",
  SpotCatalogParams,
  SpotProduct
>;

/** An immutable spot catalog request builder bound to one client. */
export class SpotCatalogBuilder extends CatalogBuilder<
  "catalog.spot",
  SpotCatalogParams,
  SpotProduct
> {
  constructor(params: SpotCatalogParams, query: SpotCatalogQueryFactory) {
    super("catalog.spot", params, prepareSpotCatalogParams, query);
  }
}
