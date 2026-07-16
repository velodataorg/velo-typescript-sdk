import type { TimeRange } from "../resolution/align.js";
import { alignRange } from "../resolution/align.js";
import type { Http, RequestOptions } from "../transport/http.js";
import { assertCsvHeader, parseCsv } from "../util/csv.js";
import { chunkRange } from "./chunk.js";
import type { Row } from "./result.js";
import { ROWS_BASE_COLUMNS } from "./result.js";
import type { RowsParams } from "./rows-params.js";
import { snapshotRowsParams, toHttpParams, validateRowsParams } from "./rows-params.js";

/**
 * One /api/v1/rows query, sealed and lazy: constructing it validates the
 * params (throwing VeloError on a bad query) but nothing is sent until
 * `execute()`. Created via `velo.futures.query(...)` and friends.
 */
export class Query<C extends string> {
  /** The validated params as they will be sent, including the market type. */
  readonly params: RowsParams;
  private readonly http: Http;

  constructor(http: Http, params: RowsParams) {
    validateRowsParams(params);
    this.http = http;
    this.params = snapshotRowsParams(params);
  }

  /**
   * Fire the query and collect every row. begin/end are aligned to whole
   * resolution buckets before sending (begin floors, end ceils), and ranges
   * exceeding the server's per-request budget are fetched in chunks and
   * concatenated in time order. All-or-nothing: a failed chunk rejects the
   * whole call; use `stream()` to consume rows as they arrive instead.
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
   * Fire the query and yield rows in time order as they arrive, one chunked
   * request at a time with the next chunk prefetched while the current one is
   * consumed. Lazy: nothing is sent until the first `next()`. Unlike
   * `execute()`, a failed chunk can reject the iteration after earlier rows
   * were already yielded.
   */
  async *stream(options: RequestOptions = {}): AsyncGenerator<Row<C>, void, undefined> {
    const { params } = this;
    const range = alignRange({ begin: params.begin, end: params.end }, params.resolution);
    const steps = chunkRange(params, range);

    // The prefetch must die with the generator: an early break/throw aborts
    // the in-flight request (and its retry backoff) instead of leaking it.
    const abort = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, abort.signal]) : abort.signal;
    const opts = { ...options, signal };

    let next = this.fetchChunk(steps[0] as TimeRange, opts);
    try {
      for (let i = 0; i < steps.length; i++) {
        const rows = await next;
        const step = steps[i + 1];
        if (step) next = this.fetchChunk(step, opts); // download while the consumer iterates
        yield* rows;
      }
    } finally {
      abort.abort();
      next.catch(() => {}); // an unconsumed prefetch must not surface as an unhandled rejection
    }
  }

  [Symbol.asyncIterator](): AsyncGenerator<Row<C>, void, undefined> {
    return this.stream();
  }

  /** Fetch and parse one chunk of the range through the retrying transport. */
  private async fetchChunk(step: TimeRange, options: RequestOptions): Promise<Row<C>[]> {
    const body = await this.http.text("/api/v1/rows", toHttpParams(this.params, step), options);
    const { columns, rows } = parseCsv(body);
    assertCsvHeader(columns, [...ROWS_BASE_COLUMNS, ...this.params.columns], "/api/v1/rows");
    return rows as Row<C>[];
  }
}
