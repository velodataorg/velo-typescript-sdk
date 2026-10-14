import type { Http, HttpParams, HttpRequestOptions } from "../../transport/http.ts";
import { assert } from "../../util/assert.ts";

/** Maximum number of HTTP requests that one query may contain. */
export const MAX_REQUESTS_PER_QUERY = 10_000;

/* Bounded so a chunked query overlaps downloads without racing far ahead of
 * the consumer or monopolizing the client-side rate limiter.
 */
export const MAX_IN_FLIGHT_REQUESTS = 4;

/**
 * One HTTP request made by a query.
 *
 * A query may contain multiple requests when an endpoint splits its work
 * into chunks.
 */
export interface HttpRequest {
  readonly path: string;
  readonly params: HttpParams;
}

/*
 * How a query reads each response: whole, or line by line as it arrives.
 * An endpoint gives one or the other. Line-oriented endpoints (CSV) stream
 * their body, so rows surface before the last byte lands; whole-document
 * ones (JSON) are buffered and decoded at once.
 */
export type QueryDecoder<T> =
  | {
      readonly decode: (body: string) => readonly T[];
      readonly decodeLines?: never;
    }
  | {
      readonly decodeLines: (lines: AsyncIterable<string>) => AsyncIterable<T>;
      readonly decode?: never;
    };

/**
 * Everything a query needs to execute and decode its responses.
 *
 * @typeParam T - One decoded response item.
 * @typeParam D - The value awaiting the query resolves to.
 */
export type QueryOptions<T, D = T[]> = QueryDecoder<T> & {
  readonly requests: readonly HttpRequest[];

  /**
   * Shapes the collected items into the awaited result.
   *
   * When omitted, `D` must be `T[]` and the items are returned as-is.
   */
  collect?(items: T[]): D;
};

/** A transport-ready plan consumed by a lazy {@link Query}. */
export type QueryPlan<T, D = T[]> = QueryOptions<T, D>;

/**
 * A lazy, self-contained query bound to an HTTP transport.
 *
 * No request is sent until the query is awaited or the iterator returned by
 * {@link Query#stream | stream()} is advanced.
 *
 * @typeParam T - One decoded response item.
 * @typeParam D - The value awaiting this query resolves to.
 */
export class Query<T, D = T[]> {
  readonly #http: Http;
  readonly #options: QueryOptions<T, D>;
  readonly #requestOptions: HttpRequestOptions;

  /**
   * @param http - The transport used to send the query's requests.
   * @param options - The requests and endpoint-specific response decoder.
   * @param requestOptions - Default transport options for awaiting or streaming the query.
   */
  constructor(http: Http, options: QueryOptions<T, D>, requestOptions?: HttpRequestOptions) {
    assert(
      options.requests.length <= MAX_REQUESTS_PER_QUERY,
      () =>
        `Query has ${options.requests.length} HTTP requests, exceeding the limit of ` +
        `${MAX_REQUESTS_PER_QUERY}`,
    );
    this.#http = http;
    this.#options = Query.#snapshot(options);
    this.#requestOptions = Query.#snapshotRequestOptions(requestOptions ?? {});
  }

  /**
   * The immutable options captured when this query was constructed.
   */
  get options(): QueryOptions<T, D> {
    return this.#options;
  }

  /**
   * Executes the query, collecting every decoded row.
   *
   */
  execute(): Promise<D> {
    return this.#collect();
  }

  /** Executes every request and collects its decoded rows. */
  async #collect(): Promise<D> {
    const rows: T[] = [];
    for await (const row of this.stream()) {
      rows.push(row);
    }
    const { collect } = this.#options;
    /* The cast is sound: collect omitted implies D = T[]. */
    return collect ? collect(rows) : (rows as T[] & D);
  }

  /**
   * Executes the query and yields decoded rows in request order.
   *
   * Up to {@link MAX_IN_FLIGHT_REQUESTS} requests overlap while earlier
   * responses are consumed; rows still arrive strictly in request order.
   * Ending iteration early aborts the outstanding requests.
   *
   * @returns An async generator of decoded rows.
   */
  async *stream(): AsyncGenerator<T, void, undefined> {
    const { requests } = this.#options;
    if (requests.length === 0) return;

    const controller = new AbortController();
    const signal = this.#requestOptions.signal
      ? AbortSignal.any([this.#requestOptions.signal, controller.signal])
      : controller.signal;
    const requestOptions: HttpRequestOptions = { ...this.#requestOptions, signal };

    /* A rejection is handled when its promise is dequeued below; the no-op
     * catch keeps a failure from becoming an unhandled rejection while
     * earlier responses are still being yielded.
     */
    const inFlight: Promise<AsyncIterable<T> | readonly T[]>[] = [];
    let next = 0;
    const start = (): void => {
      const rows = this.#open(requests[next++]!, requestOptions);
      rows.catch(() => {});
      inFlight.push(rows);
    };

    try {
      while (next < requests.length && inFlight.length < MAX_IN_FLIGHT_REQUESTS) start();
      while (inFlight.length > 0) {
        const rows = await inFlight.shift()!;
        if (next < requests.length) start();
        yield* rows;
      }
    } finally {
      controller.abort();
    }
  }

  /**
   * Starts one request and returns its decoded rows.
   *
   * The promise settles once the response headers arrive, so a prefetched
   * request is genuinely in flight. With `decodeLines` the resolved value is
   * a lazy iterable read from the body as it streams; with `decode` the body
   * is buffered and decoded whole.
   */
  async #open(
    request: HttpRequest,
    options: HttpRequestOptions,
  ): Promise<AsyncIterable<T> | readonly T[]> {
    const decoder: QueryDecoder<T> = this.#options;
    if (decoder.decodeLines !== undefined) {
      const lines = await this.#http.openLines(request.path, request.params, options);
      return decoder.decodeLines(lines);
    }
    const body = await this.#http.text(request.path, request.params, options);
    return decoder.decode(body);
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
    const decoder: QueryDecoder<T> =
      options.decodeLines === undefined
        ? { decode: options.decode }
        : { decodeLines: options.decodeLines };
    return Object.freeze({
      requests,
      ...decoder,
      ...(options.collect ? { collect: options.collect } : {}),
    });
  }

  /** Snapshots query-level transport defaults without cloning the signal. */
  static #snapshotRequestOptions(options: HttpRequestOptions): HttpRequestOptions {
    const snapshot: HttpRequestOptions = {
      ...options,
      ...(options.retry ? { retry: Object.freeze({ ...options.retry }) } : {}),
    };
    return Object.freeze(snapshot);
  }
}
