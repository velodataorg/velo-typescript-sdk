import { alignRange } from "./align.js";
import { chunkRange } from "./chunk.js";
import type { MarketType, TermsCoin } from "./constants.js";
import { TERMS_COINS } from "./constants.js";
import type { ColumnFor, RowsParamsCoinsV1, RowsParamsProductsV1 } from "./param.js";
import { rowsQueryParams, validateRowsParams } from "./param.js";
import type { CapsRow, RowsRow, TermsRow } from "./row.js";
import { CAPS_COLUMNS, ROWS_BASE_COLUMNS, TERMS_COLUMNS } from "./row.js";
import { Http } from "./transport/http.js";
import type { HttpConfig, RequestOptions } from "./transport/http.js";
import { assert } from "./util/assert.js";
import { parseCsv } from "./util/csv.js";

export type VeloConfig = HttpConfig;

/** Asserts a non-empty response's header matches the expected columns exactly, in order. */
function assertColumns(actual: readonly string[], expected: readonly string[], path: string): void {
  if (actual.length === 0) return; // zero-row responses have no header
  assert(
    actual.length === expected.length && actual.every((col, i) => col === expected[i]),
    () => `unexpected ${path} response header ${actual.join(",")} (expected ${expected.join(",")})`,
  );
}

export class Velo {
  private readonly http: Http;

  constructor(config: VeloConfig) {
    this.http = new Http(config);
  }

  /**
   * Query market data rows (/api/v1/rows). begin/end are aligned to whole
   * resolution buckets before sending (begin floors, end ceils), and ranges
   * exceeding the server's per-request budget are fetched in sequential
   * chunks and concatenated in time order.
   *
   * Rows are typed by the requested columns: pass a columns literal and each
   * row is the base columns plus exactly those fields. A pre-widened array
   * (e.g. `FuturesColumn[]`) degrades to rows typed with every column.
   */
  async rows<T extends MarketType, C extends ColumnFor<T>>(
    params: RowsParamsProductsV1<T, C> | RowsParamsCoinsV1<T, C>,
    options?: RequestOptions,
  ): Promise<RowsRow<C>[]> {
    validateRowsParams(params);
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

  /** Query market caps (/api/v1/caps). */
  async caps(coins: readonly string[], options?: RequestOptions): Promise<CapsRow[]> {
    assert(coins.length > 0, "coins must not be empty");
    const body = await this.http.text("/api/v1/caps", { coins }, options);
    const { columns, rows } = parseCsv(body);
    assertColumns(columns, CAPS_COLUMNS, "/api/v1/caps");
    return rows as CapsRow[];
  }

  /** Query the options term structure (/api/v1/terms). Only BTC and ETH are supported. */
  async terms(coins: readonly TermsCoin[], options?: RequestOptions): Promise<TermsRow[]> {
    assert(coins.length > 0, "coins must not be empty");
    assert(
      coins.every((coin) => TERMS_COINS.includes(coin)),
      `terms coins must be among ${TERMS_COINS.join(", ")}`,
    );
    const body = await this.http.text("/api/v1/terms", { coins }, options);
    const { columns, rows } = parseCsv(body);
    assertColumns(columns, TERMS_COLUMNS, "/api/v1/terms");
    return rows as TermsRow[];
  }
}
