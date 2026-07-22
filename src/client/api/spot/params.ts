import { z } from "zod";

import { VeloError } from "../../../errors.js";
import { SPOT_COLUMNS, type SpotColumn } from "../../common/market/columns.js";
import { SPOT_EXCHANGES, type SpotExchange } from "../../common/market/exchanges.js";
import { RowsParams } from "../../common/rows/params.js";

export type SpotParams<C extends SpotColumn = SpotColumn> = RowsParams<SpotExchange, C>;

const SpotParamsSchema = RowsParams.schema(SPOT_EXCHANGES, SPOT_COLUMNS);

export const SpotParams = Object.freeze({
  /** Validates spot parameters while preserving their static column selection. */
  parse<P extends SpotParams>(params: P): P {
    const parsed = SpotParamsSchema.safeParse(params);
    if (!parsed.success) {
      throw new VeloError(`Invalid spot params:\n${z.prettifyError(parsed.error)}`);
    }

    /* Zod preserves the selected columns but necessarily returns their full schema union. */
    return parsed.data as unknown as P;
  },
});
