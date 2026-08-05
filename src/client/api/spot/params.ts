import { z } from "zod";

import type { Equals, Expect } from "../../../util/types.ts";
import type { Row } from "../../data/row.ts";
import { SPOT_COLUMNS, type SpotColumn } from "../../market/columns.ts";
import { SPOT_EXCHANGES, type SpotExchange } from "../../market/exchanges.ts";
import { RowsParams } from "../../rows/params.ts";
import { invalidParamsError } from "../../validation.ts";

export type SpotParams<
  C extends SpotColumn = SpotColumn,
  E extends SpotExchange = SpotExchange,
> = RowsParams<E, C>;

export type SpotRow<C extends SpotColumn, E extends SpotExchange = SpotExchange> = Row<E, C>;

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
      throw invalidParamsError("spot", parsed.error);
    }

    /* Return a clone of the validated input: its type is already P, where Zod's
       output necessarily widens back to the full column union. */
    return structuredClone(params);
  },
});
