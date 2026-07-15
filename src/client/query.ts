import { alignRange } from "../resolution/align.js";
import type { Http, RequestOptions } from "../transport/http.js";
import { assertColumns, parseCsv } from "../util/csv.js";
import { chunkRange } from "./chunk.js";
import type { Row } from "./result.js";
import { ROWS_BASE_COLUMNS } from "./result.js";
import type { RowsParams } from "./rows-params.js";
import { toHttpParams, validateRowsParams } from "./rows-params.js";

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
    this.params = params;
  }

  /**
   * Fire the query. begin/end are aligned to whole resolution buckets before
   * sending (begin floors, end ceils), and ranges exceeding the server's
   * per-request budget are fetched in sequential chunks and concatenated in
   * time order.
   */
  async execute(options?: RequestOptions): Promise<Row<C>[]> {
    const { params } = this;
    const expected = [...ROWS_BASE_COLUMNS, ...params.columns];
    const range = alignRange({ begin: params.begin, end: params.end }, params.resolution);
    const chunks: Row<C>[][] = [];
    for (const step of chunkRange(params, range)) {
      const body = await this.http.text("/api/v1/rows", toHttpParams(params, step), options);
      const { columns, rows } = parseCsv(body);
      assertColumns(columns, expected, "/api/v1/rows");
      chunks.push(rows as Row<C>[]);
    }
    return chunks.flat();
  }
}
