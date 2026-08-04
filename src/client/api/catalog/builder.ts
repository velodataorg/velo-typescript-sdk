import type { HttpRequestOptions } from "../../../transport/http.ts";
import type {
  QueryBuilder,
  QueryFactory,
  QueryItem,
  QueryParams,
  QueryRequest,
  QueryResult,
} from "../../plan.ts";
import { type FuturesCatalogParams, prepareFuturesCatalogParams } from "./futures.ts";
import { type OptionsCatalogParams, prepareOptionsCatalogParams } from "./options.ts";
import { prepareSpotCatalogParams, type SpotCatalogParams } from "./spot.ts";

type CatalogKind = "catalog.futures" | "catalog.options" | "catalog.spot";

class CatalogBuilder<K extends CatalogKind, P extends QueryParams<K>> implements QueryBuilder<
  K,
  P
> {
  readonly #request: QueryRequest<K, P>;
  readonly #query: QueryFactory<K>;

  constructor(kind: K, params: P, validate: (params: P) => unknown, query: QueryFactory<K>) {
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
  fetch(options?: HttpRequestOptions): Promise<QueryResult<K, P>> {
    return this.#query(this.#request).execute(options);
  }

  /** Creates a lazy query and streams products through the bound client. */
  stream(options?: HttpRequestOptions): AsyncIterable<QueryItem<K, P>> {
    return this.#query(this.#request).stream(options);
  }
}

/** An immutable futures catalog request builder bound to one client. */
export class FuturesCatalogBuilder extends CatalogBuilder<"catalog.futures", FuturesCatalogParams> {
  constructor(params: FuturesCatalogParams, query: QueryFactory<"catalog.futures">) {
    super("catalog.futures", params, prepareFuturesCatalogParams, query);
  }
}

/** An immutable options catalog request builder bound to one client. */
export class OptionsCatalogBuilder extends CatalogBuilder<"catalog.options", OptionsCatalogParams> {
  constructor(params: OptionsCatalogParams, query: QueryFactory<"catalog.options">) {
    super("catalog.options", params, prepareOptionsCatalogParams, query);
  }
}

/** An immutable spot catalog request builder bound to one client. */
export class SpotCatalogBuilder extends CatalogBuilder<"catalog.spot", SpotCatalogParams> {
  constructor(params: SpotCatalogParams, query: QueryFactory<"catalog.spot">) {
    super("catalog.spot", params, prepareSpotCatalogParams, query);
  }
}
