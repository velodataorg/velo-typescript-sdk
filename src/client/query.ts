import type { Http, HttpParams, RequestOptions } from "../transport/http.js";
import type { CsvRow, CsvSchema } from "../util/csv.js";
import { decodeCsv } from "../util/csv.js";

/**
 * A query lowered to wire form: everything the executor needs, as pure data.
 * Produced by an endpoint's prepare function, which has already validated
 * the params — a `PreparedParams` value is executable by construction.
 *
 * @typeParam R - The row type `schema` decodes to. It exists only at the
 * type level, recorded by the prepare function so {@link Query} can surface
 * typed rows.
 */
export interface PreparedParams<R extends CsvRow> {
  /* The endpoint path every request goes to. */
  readonly path: string;
  /* The wire query of each GET request; /rows queries chunk into several. */
  readonly requests: readonly HttpParams[];
  /* The expected response columns, used to decode every response body. */
  readonly schema: CsvSchema;
  /* Phantom, never set at runtime: ties R to the value so prepared queries
   * of different endpoints cannot be mixed up.
   */
  readonly _row?: R;
}

/**
 * Freezes a prepared query in place — the requests, their arrays, the
 * schema, and the container — so the snapshot exposed via
 * {@link Query.prepared} cannot be mutated; the readonly types only stop
 * TypeScript callers.
 *
 * @remarks
 * Prepare functions must build requests from arrays they own (copies), never
 * the caller's: the arrays are frozen in place.
 *
 * @param prepared - The prepared query to freeze.
 * @returns The same object, deep-frozen.
 */
export function freezePrepared<R extends CsvRow>(prepared: PreparedParams<R>): PreparedParams<R> {
  for (const request of prepared.requests) {
    for (const value of Object.values(request)) {
      if (Array.isArray(value)) Object.freeze(value);
    }
    Object.freeze(request);
  }
  Object.freeze(prepared.requests);
  Object.freeze(prepared.schema);
  return Object.freeze(prepared);
}

/**
 * One prepared query bound to a transport, lazy: nothing is sent until
 * {@link Query.execute | execute()} or the stream's first `next()`.
 *
 * @remarks
 * Created by the client's endpoints (`velo.futures.query()`, `velo.caps()`,
 * `velo.options.terms()`), whose prepare step validates and lowers the
 * params first — an invalid query never constructs. The executor is
 * endpoint-blind: it only walks `prepared.requests` and decodes each
 * response against `prepared.schema`.
 *
 * @typeParam R - The row type the responses decode to.
 */
export class Query<R extends CsvRow> {
  readonly #http: Http;
  readonly #prepared: PreparedParams<R>;

  /**
   * @param http - The transport requests are sent through.
   * @param prepared - The lowered query, from an endpoint's prepare function.
   */
  constructor(http: Http, prepared: PreparedParams<R>) {
    this.#http = http;
    this.#prepared = prepared;
  }

  /* The lowered query as it will be sent: `requests.length` is the number of
   * GET requests execution makes.
   */
  get prepared(): PreparedParams<R> {
    return this.#prepared;
  }

  /**
   * Fires the query and collects every row.
   *
   * @remarks
   * All-or-nothing: a failed request rejects the whole call; use
   * {@link Query.stream | stream()} to consume rows as they arrive instead.
   *
   * @param options - Per-request transport options.
   * @returns Every row across all requests, in request order.
   */
  async execute(options?: RequestOptions): Promise<R[]> {
    // Collected by hand: Array.fromAsync would raise the Node floor to 22.
    const rows: R[] = [];
    for await (const row of this.stream(options)) {
      rows.push(row);
    }
    return rows;
  }

  /**
   * Fires the query and yields rows in request order as they arrive.
   *
   * @remarks
   * Fetches one request at a time, with the next one prefetched while the
   * current one is consumed:
   *
   * ```text
   * [fetch 1][fetch 2 ][fetch 3 ]
   *          [yield 1…][yield 2…][yield 3…]
   * ```
   *
   * Lazy: nothing is sent until the first `next()`. Unlike
   * {@link Query.execute | execute()}, a failed request can reject the
   * iteration after earlier rows were already yielded.
   *
   * @param options - Per-request transport options.
   * @returns An async generator over the rows, in request order.
   */
  async *stream(options: RequestOptions = {}): AsyncGenerator<R, void, undefined> {
    const { requests } = this.#prepared;

    // The prefetch must die with the generator: an early break/throw aborts
    // the in-flight request (and its retry backoff) instead of leaking it.
    const abort = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, abort.signal]) : abort.signal;
    const opts = { ...options, signal };

    // A fetch can reject while the generator is suspended between yields,
    // where nothing is awaiting it — without a handler already attached,
    // Node reports an unhandled rejection and kills the process. The error
    // still surfaces at the next `await next`.
    const start = (request: HttpParams) => {
      const rows = this.#fetch(request, opts);
      rows.catch(() => {});
      return rows;
    };

    let next = start(requests[0] as HttpParams);
    try {
      for (let i = 0; i < requests.length; i++) {
        const rows = await next;
        const request = requests[i + 1];
        if (request) next = start(request); // download while the consumer iterates
        yield* rows;
      }
    } finally {
      abort.abort();
    }
  }

  /**
   * Fetches and decodes one request through the retrying transport.
   *
   * @param request - The wire query of the request.
   * @param options - Per-request transport options.
   * @returns The request's rows.
   */
  async #fetch(request: HttpParams, options: RequestOptions): Promise<R[]> {
    const { path, schema } = this.#prepared;
    const body = await this.#http.text(path, request, options);
    // The cast is sound: decodeCsv validated every field against the schema,
    // and R is derived from that schema by the prepare function.
    return decodeCsv(body, schema, path) as R[];
  }
}
