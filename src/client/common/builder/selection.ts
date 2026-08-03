import { assert } from "../../../util/assert.ts";

/**
 * Resolves an optional part selection against one selector's column map.
 *
 * @param selector - The public selector name, used in error messages.
 * @param columns - The selector's columns keyed by part name.
 * @param parts - The selected parts; undefined selects every part.
 * @returns The selected columns in argument order, or every column in map
 * order when `parts` is undefined.
 * @throws {@link VeloError} when `parts` is not an array, is an empty array,
 * or names an unknown part. Untyped callers can reach the first and last
 * case; the overloads reject them at compile time.
 */
export function partColumns<P extends string, Column extends string>(
  selector: string,
  columns: Readonly<Record<P, Column>>,
  parts: readonly P[] | undefined,
): Column[] {
  if (parts === undefined) return Object.values(columns);
  assert(
    Array.isArray(parts),
    () => `${selector}() takes an array of parts; wrap a single part in an array`,
  );
  assert(
    parts.length > 0,
    `${selector}() requires a non-empty selection; omit the argument to select all`,
  );
  /* The parameter annotation restores P after isArray narrowed `parts` to
   * `any[]`.
   */
  return parts.map((part: P) => {
    assert(
      Object.hasOwn(columns, part),
      () => `${selector}() received an unknown part ${JSON.stringify(part)}`,
    );
    return columns[part];
  });
}

/**
 * Resolves a metric-selector options bag to its column map.
 *
 * @param selector - The public selector name, used in error messages.
 * @param tree - The selector's column maps keyed by metric.
 * @param options - The options bag; the metric defaults to `"dollar"`.
 * @returns The column map for the selected metric.
 * @throws {@link VeloError} when `options` is not an object or names an
 * unknown metric. Only untyped callers can reach either case; the overloads
 * reject them at compile time.
 */
export function metricColumns<M extends string, Columns>(
  selector: string,
  tree: Readonly<Record<M | "dollar", Columns>>,
  options: { readonly metric: M | "dollar" } | undefined,
): Columns {
  assert(
    options === undefined ||
      (typeof options === "object" && options !== null && !Array.isArray(options)),
    () => `${selector}() options must be an object`,
  );
  const metric = options?.metric ?? "dollar";
  assert(
    Object.hasOwn(tree, metric),
    () => `${selector}() received an unknown metric ${JSON.stringify(metric)}`,
  );
  return tree[metric];
}

/**
 * Splits a selector's first argument into its parts-or-options overload
 * forms.
 *
 * @param selector - The public selector name, used in error messages.
 * @param partsOrOptions - The first argument: a parts array, an options
 * object, or undefined.
 * @param options - The second argument, present only after a parts array.
 * @returns The parts and options under their own names.
 * @throws {@link VeloError} when the first argument is neither. Only untyped
 * callers can reach this; the overloads reject it at compile time.
 */
export function splitParts<P extends string, Options extends object>(
  selector: string,
  partsOrOptions: readonly P[] | Options | undefined,
  options: Options | undefined,
): { parts: readonly P[] | undefined; options: Options | undefined } {
  /* Array.isArray does not narrow readonly arrays out of a union, so both
   * branches restate what the check established.
   */
  if (Array.isArray(partsOrOptions)) {
    return { parts: partsOrOptions as readonly P[], options };
  }
  assert(
    partsOrOptions === undefined || (typeof partsOrOptions === "object" && partsOrOptions !== null),
    () => `${selector}() takes a parts array or an options object; wrap a single part in an array`,
  );
  return { parts: undefined, options: partsOrOptions as Options | undefined };
}
