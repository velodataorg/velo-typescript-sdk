import { z } from "zod";

import { VeloError } from "../../../errors.js";
import type { Equals, Expect } from "../../../util/types.js";
import { SPOT_COLUMNS, type SpotColumn } from "../../common/market/columns.js";
import { SPOT_EXCHANGES, type SpotExchange } from "../../common/market/exchanges.js";
import { RowsParams } from "../../common/rows/params.js";

export type SpotParams<C extends SpotColumn = SpotColumn> = RowsParams<SpotExchange, C>;

const SpotParamsSchema = RowsParams.schema(SPOT_EXCHANGES, SPOT_COLUMNS);

/* parse() returns a clone of its input, so the schema must never transform values. */
type _SchemaDoesNotTransform = Expect<
  Equals<z.input<typeof SpotParamsSchema>, z.output<typeof SpotParamsSchema>>
>;

export const SpotParams = Object.freeze({
  /** Validates spot parameters while preserving their static column selection. */
  parse<P extends SpotParams>(params: P): P {
    const parsed = SpotParamsSchema.safeParse(params);
    if (!parsed.success) {
      throw new VeloError(`Invalid spot params:\n${z.prettifyError(parsed.error)}`);
    }

    /* Return a clone of the validated input: its type is already P, where Zod's
       output necessarily widens back to the full column union. */
    return structuredClone(params);
  },
});
