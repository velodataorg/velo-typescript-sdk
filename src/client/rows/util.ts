import type { AnyRowsParams } from "./params.js";

/* Special-cased in both validation and chunk pricing. */
export const BASIS_COLUMN = "3m_basis_ann";

/**
 * Whether the query selects the basis column, which the server validates and
 * prices specially.
 *
 * @param params - The params to inspect.
 * @returns True if `columns` includes `3m_basis_ann`.
 */
export function isBasisQuery(params: AnyRowsParams): boolean {
  return (params.columns as readonly string[]).includes(BASIS_COLUMN);
}
