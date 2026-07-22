import { z } from "zod";

import { VeloError } from "../../../../errors.js";
import { OPTIONS_EXCHANGES, type OptionsExchange } from "../../../../exchange.js";
import { OPTIONS_COLUMNS, type OptionsColumn } from "../columns.js";
import type { Row } from "../data.js";
import { RowsParams } from "../params.js";

export type OptionsRow<C extends OptionsColumn> = Row<OptionsExchange, C>;
export type OptionsParams<C extends OptionsColumn = OptionsColumn> = RowsParams<OptionsExchange, C>;

const OptionsParamsSchema = RowsParams.schema(OPTIONS_EXCHANGES, OPTIONS_COLUMNS);

export const OptionsParams = Object.freeze({
  /** Validates options parameters while preserving their static column selection. */
  parse<P extends OptionsParams>(params: P): P {
    const parsed = OptionsParamsSchema.safeParse(params);
    if (!parsed.success) {
      throw new VeloError(`Invalid options params:\n${z.prettifyError(parsed.error)}`);
    }

    /* Zod preserves the selected columns but necessarily returns their full schema union. */
    return parsed.data as unknown as P;
  },
});
