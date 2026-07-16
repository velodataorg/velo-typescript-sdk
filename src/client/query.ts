import { ROWS_PATH } from "../constants.js";
import type { TimeRange } from "../resolution/align.js";
import { alignRange } from "../resolution/align.js";
import type { Http, RequestOptions } from "../transport/http.js";
import type { CsvSchema } from "../util/csv.js";
import { decodeCsv } from "../util/csv.js";
import { chunkRange } from "./chunk.js";
import type { Row } from "./result.js";
import { ROWS_BASE_SCHEMA } from "./result.js";
import type { RowsParams } from "./rows-params.js";
import { toHttpParams, validateRowsParams } from "./rows-params.js";

/**
 * One `/api/v1/rows` query, sealed and lazy: constructing it validates the
 * params (throwing `VeloError` on a bad query) but nothing is sent until
 * {@link Query.execute | execute()}.
 *
 * @typeParam C - The requested column names; each row is typed as the base
 * columns plus these fields.
 */
export class Query<C extends string> {
  readonly #params: RowsParams;
  readonly #http: Http;
  /* begin/end aligned to whole resolution buckets, as actually sent. */
  readonly #range: TimeRange;
  /* The expected response columns: the base columns plus the requested ones. */
  readonly #schema: CsvSchema;

  /**
   * Validates and seals the params; nothing is sent.
   *
   * @param http - The transport requests are sent through.
   * @param params - The query params, including the market type.
   * @throws If the params fail validation.
   */
  constructor(http: Http, params: RowsParams) {
    validateRowsParams(params);
    this.#http = http;
    // Seal the params: copy the arrays so the caller's own references cannot
    // mutate the query after validation, then freeze everything so the
    // snapshot exposed via the params getter cannot be mutated either — the
    // readonly types only stop TypeScript callers.
    const copies = {
      columns: Object.freeze([...params.columns]),
      ...(params.exchanges && { exchanges: Object.freeze([...params.exchanges]) }),
    };
    // Branch on the selector so each arm builds one closed variant of the union.
    this.#params =
      params.coins !== undefined
        ? Object.freeze({ ...params, ...copies, coins: Object.freeze([...params.coins]) })
        : Object.freeze({ ...params, ...copies, products: Object.freeze([...params.products]) });
    this.#range = alignRange({ begin: params.begin, end: params.end }, params.resolution);
    this.#schema = {
      ...ROWS_BASE_SCHEMA,
      ...Object.fromEntries(
        this.#params.columns.map((column) => [column, "nullable-number"] as const),
      ),
    };
  }

  get params(): RowsParams {
    return this.#params;
  }

  /**
   * Fires the query and collects every row.
   *
   * @remarks
   * `begin`/`end` are aligned to whole resolution buckets before sending
   * (begin floors, end ceils), and ranges exceeding the server's per-request
   * budget are fetched in chunks and concatenated in time order.
   * All-or-nothing: a failed chunk rejects the whole call; use
   * {@link Query.stream | stream()} to consume rows as they arrive instead.
   *
   * @param options - Per-request transport options.
   * @returns Every row in the aligned range, in time order.
   */
  async execute(options?: RequestOptions): Promise<Row<C>[]> {
    // Collected by hand: Array.fromAsync would raise the Node floor to 22.
    const rows: Row<C>[] = [];
    for await (const row of this.stream(options)) {
      rows.push(row);
    }
    return rows;
  }

  /**
   * Fires the query and yields rows in time order as they arrive.
   *
   * @remarks
   * Fetches one chunked request at a time, with the next chunk prefetched
   * while the current one is consumed:
   *
   * ```text
   * [fetch 1][fetch 2 ][fetch 3 ]
   *          [yield 1…][yield 2…][yield 3…]
   * ```
   *
   * Lazy: nothing is sent until the first `next()`. Unlike
   * {@link Query.execute | execute()}, a failed chunk can reject the
   * iteration after earlier rows were already yielded.
   *
   * @param options - Per-request transport options.
   * @returns An async generator over the rows, in time order.
   */
  async *stream(options: RequestOptions = {}): AsyncGenerator<Row<C>, void, undefined> {
    const steps = chunkRange(this.#params, this.#range);

    // The prefetch must die with the generator: an early break/throw aborts
    // the in-flight request (and its retry backoff) instead of leaking it.
    const abort = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, abort.signal]) : abort.signal;
    const opts = { ...options, signal };

    // A fetch can reject while the generator is suspended between yields,
    // where nothing is awaiting it — without a handler already attached,
    // Node reports an unhandled rejection and kills the process. The error
    // still surfaces at the next `await next`.
    const start = (step: TimeRange) => {
      const chunk = this.#fetchChunk(step, opts);
      chunk.catch(() => {});
      return chunk;
    };

    let next = start(steps[0] as TimeRange);
    try {
      for (let i = 0; i < steps.length; i++) {
        const rows = await next;
        const step = steps[i + 1];
        if (step) next = start(step); // download while the consumer iterates
        yield* rows;
      }
    } finally {
      abort.abort();
    }
  }

  /**
   * Fetches and parses one chunk of the range through the retrying transport.
   *
   * @param step - The chunk's time range.
   * @param options - Per-request transport options.
   * @returns The chunk's rows.
   */
  async #fetchChunk(step: TimeRange, options: RequestOptions): Promise<Row<C>[]> {
    const body = await this.#http.text(ROWS_PATH, toHttpParams(this.#params, step), options);
    // The cast is sound: decodeCsv validated every field against the schema.
    return decodeCsv(body, this.#schema, ROWS_PATH) as Row<C>[];
  }
}
