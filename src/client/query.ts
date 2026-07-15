import type { Http, RequestOptions } from "../transport/http.js";
import { assertColumns, parseCsv } from "../util/csv.js";
import { alignRange } from "./align.js";
import { chunkRange } from "./chunk.js";
import type { ResolvedParamsV1 } from "./param.js";
import { rowsQueryParams, validateQueryParams } from "./param.js";
import type { RowsRow } from "./row.js";
import { ROWS_BASE_COLUMNS } from "./row.js";

/**
 * One /api/v1/rows query, sealed and lazy: constructing it validates the
 * params (throwing VeloError on a bad query) but nothing is sent until
 * `execute()`. Created via `velo.futures.query(...)` and friends.
 */
export class Query<C extends string> {
  /** The validated params as they will be sent, including the market type. */
  readonly params: ResolvedParamsV1;
  private readonly http: Http;

  constructor(http: Http, params: ResolvedParamsV1) {
    validateQueryParams(params);
    this.http = http;
    this.params = params;
  }

  /**
   * Fire the query. begin/end are aligned to whole resolution buckets before
   * sending (begin floors, end ceils), and ranges exceeding the server's
   * per-request budget are fetched in sequential chunks and concatenated in
   * time order.
   */
  async execute(options?: RequestOptions): Promise<RowsRow<C>[]> {
    const { params } = this;
    const expected = [...ROWS_BASE_COLUMNS, ...params.columns];
    const range = alignRange({ begin: params.begin, end: params.end }, params.resolution);
    const chunks: RowsRow<C>[][] = [];
    for (const step of chunkRange(params, range)) {
      const body = await this.http.text("/api/v1/rows", rowsQueryParams(params, step), options);
      const { columns, rows } = parseCsv(body);
      assertColumns(columns, expected, "/api/v1/rows");
      chunks.push(rows as RowsRow<C>[]);
    }
    return chunks.flat();
  }
}
