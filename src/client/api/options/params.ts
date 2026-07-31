import { z } from "zod";

import type { Equals, Expect } from "../../../util/types.js";
import type { Row } from "../../common/data/row.js";
import { OPTIONS_COLUMNS, type OptionsColumn } from "../../common/market/columns.js";
import { OPTIONS_EXCHANGES, type OptionsExchange } from "../../common/market/exchanges.js";
import { RowsParams } from "../../common/rows/params.js";
import { invalidParamsError } from "../../common/validation.js";

export type OptionsRow<C extends OptionsColumn> = Row<OptionsExchange, C>;
export type OptionsParams<C extends OptionsColumn = OptionsColumn> = RowsParams<OptionsExchange, C>;

const OptionsParamsSchema = RowsParams.schema(OPTIONS_EXCHANGES, OPTIONS_COLUMNS);

/* parse() returns a clone of its input, so the schema must never transform values. */
type _SchemaDoesNotTransform = Expect<
  Equals<z.input<typeof OptionsParamsSchema>, z.output<typeof OptionsParamsSchema>>
>;

export const OptionsParams = Object.freeze({
  /** Validates options parameters while preserving their static column selection. */
  parse<P extends OptionsParams>(params: P): P {
    const parsed = OptionsParamsSchema.safeParse(params);
    if (!parsed.success) {
      throw invalidParamsError("options", parsed.error);
    }

    /* Return a clone of the validated input: its type is already P, where Zod's
       output necessarily widens back to the full column union. */
    return structuredClone(params);
  },
});
