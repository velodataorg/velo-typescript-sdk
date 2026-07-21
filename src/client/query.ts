import type { Http, HttpParams, HttpRequestOptions } from "../transport/http.js";

/**
 * One HTTP request made by a query.
 *
 * A query may contain multiple requests when an endpoint splits its work
 * into chunks.
 */
export interface QueryRequest {
  readonly path: string;
  readonly params: HttpParams;
}

/**
 * Everything a query needs to execute and decode its responses.
 *
 * @typeParam T - One decoded response item.
 * @typeParam D - The value {@link Query.execute | execute()} resolves to.
 */
export interface QueryOptions<T, D = T[]> {
  readonly requests: readonly QueryRequest[];
  readonly decode: (body: string) => readonly T[];

  /**
   * Shapes the collected items into the executed result.
   *
   * When omitted, `D` must be `T[]` and the items are returned as-is.
   */
  collect?(items: T[]): D;
}

/**
 * A lazy, self-contained query bound to an HTTP transport.
 *
 * No request is sent until {@link Query.execute | execute()} is called or the
 * iterator returned by {@link Query.stream | stream()} is advanced.
 *
 * @typeParam T - One decoded response item.
 * @typeParam D - The value {@link Query.execute | execute()} resolves to.
 */
export class Query<T, D = T[]> {
  readonly #http: Http;
  readonly #options: QueryOptions<T, D>;

  /**
   * @param http - The transport used to send the query's requests.
   * @param options - The requests and endpoint-specific response decoder.
   */
  constructor(http: Http, options: QueryOptions<T, D>) {
    this.#http = http;
    this.#options = Query.#snapshot(options);
  }

  /**
   * The immutable options captured when this query was constructed.
   */
  get options(): QueryOptions<T, D> {
    return this.#options;
  }

  /**
   * Executes every request and collects its decoded rows.
   *
   * @param options - Per-request transport options.
   * @returns All decoded rows in request order, shaped by the query's
   * `collect` option when present.
   */
  async execute(options?: HttpRequestOptions): Promise<D> {
    const rows: T[] = [];
    for await (const row of this.stream(options)) {
      rows.push(row);
    }
    const { collect } = this.#options;
    /* The cast is sound: collect omitted implies D = T[]. */
    return collect ? collect(rows) : (rows as T[] & D);
  }

  /**
   * Executes the query and yields decoded rows in request order.
   *
   * The next request is prefetched while the current request's rows are being
   * consumed. Ending iteration early aborts that prefetch.
   *
   * @param options - Per-request transport options.
   * @returns An async generator of decoded rows.
   */
  async *stream(options: HttpRequestOptions = {}): AsyncGenerator<T, void, undefined> {
    const { requests } = this.#options;
    const first = requests[0];
    if (!first) return;

    const controller = new AbortController();
    const signal = options.signal
      ? AbortSignal.any([options.signal, controller.signal])
      : controller.signal;
    const requestOptions: HttpRequestOptions = { ...options, signal };

    const start = (request: QueryRequest): Promise<readonly T[]> => {
      const rows = this.#fetch(request, requestOptions);
      rows.catch(() => {});
      return rows;
    };

    let pending = start(first);
    try {
      for (let index = 0; index < requests.length; index++) {
        const rows = await pending;
        const next = requests[index + 1];
        if (next) pending = start(next);
        yield* rows;
      }
    } finally {
      controller.abort();
    }
  }

  /**
   * Sends and decodes one request.
   */
  async #fetch(request: QueryRequest, options: HttpRequestOptions): Promise<readonly T[]> {
    const body = await this.#http.text(request.path, request.params, options);
    return this.#options.decode(body);
  }

  /**
   * Copies and freezes the query-owned request data.
   *
   * Copying prevents the query from freezing caller-owned arrays and ensures
   * later mutations cannot change the request that will be sent.
   */
  static #snapshot<T, D>(options: QueryOptions<T, D>): QueryOptions<T, D> {
    const requests = options.requests.map((request) => {
      const params: HttpParams = {};

      for (const [name, value] of Object.entries(request.params)) {
        params[name] = Array.isArray(value)
          ? (Object.freeze([...value]) as readonly string[] | readonly number[])
          : value;
      }

      Object.freeze(params);
      return Object.freeze({ path: request.path, params });
    });

    Object.freeze(requests);
    return Object.freeze({
      requests,
      decode: options.decode,
      ...(options.collect ? { collect: options.collect } : {}),
    });
  }
}
