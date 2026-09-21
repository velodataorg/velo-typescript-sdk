import { isListed } from "../../../util/array.ts";
import { assert } from "../../../util/assert.ts";
import { isRecord } from "../../../util/object.ts";

/*
 * Reading what a caller passed as options. A builder's options are made of
 * options, chosen by name, and flags, switched on. The types rule every
 * failure here out for a TypeScript caller, so these speak to an untyped one,
 * worded like the history selectors.
 */

/* Checks one entry of a caller's options: an option, or a flag. */
export interface OptionParser<Value> {
  /**
   * Checks what a caller passed for one entry.
   *
   * @param value - What the caller passed for the entry, if anything.
   * @param name - The entry's key, such as `metric`.
   * @param indicator - The indicator's public name, such as `channel.fundingRate`, used in
   * error messages.
   * @returns The checked value, or what an omitted one means.
   * @throws A VeloError when the value is not usable.
   */
  parse(value: unknown, name: string, indicator: string): Value;
}

/**
 * Describes an option a caller chooses by name.
 *
 * @param names - The names a caller may pass.
 * @param fallback - The name an omitted value means.
 * @returns The frozen parser, yielding the name chosen.
 * @throws A VeloError when the fallback is not one of the names.
 */
export function option<const Names extends readonly string[]>(
  names: Names,
  fallback: Names[number],
): OptionParser<Names[number]> {
  assert(
    isListed(names, fallback),
    () => `an option falls back to ${JSON.stringify(fallback)}, which is not one of its names`,
  );
  return Object.freeze({
    parse(value: unknown, name: string, indicator: string): Names[number] {
      if (value === undefined) return fallback;
      assert(
        typeof value === "string" && isListed(names, value),
        () =>
          `${indicator}() received an unknown ${name} ${JSON.stringify(value)}; expected ${names.join(", ")}`,
      );
      return value;
    },
  });
}

/**
 * Describes a flag a caller switches on; an omitted one is off.
 *
 * @returns The frozen parser, yielding whether the flag is on.
 */
export function flag(): OptionParser<boolean> {
  return Object.freeze({
    parse(value: unknown, name: string, indicator: string): boolean {
      assert(
        value === undefined || typeof value === "boolean",
        () => `${indicator}() takes a boolean for ${name} (got ${JSON.stringify(value)})`,
      );
      return value === true;
    },
  });
}

/**
 * Checks a caller's options against the options and flags a builder has.
 *
 * @param input - What the caller passed; undefined means no options.
 * @param parsers - Every option and flag the builder has, keyed as a caller
 * passes them.
 * @param indicator - The indicator's public name, such as `channel.fundingRate`, used in
 * error messages.
 * @returns Each entry's checked value, with what an omitted one means filled in.
 * @throws A VeloError when the options are not an object, name an entry the
 * builder does not have, or hold a value that is not usable.
 */
export function parseOptions<const Parsers extends Readonly<Record<string, OptionParser<unknown>>>>(
  input: unknown,
  parsers: Parsers,
  indicator: string,
): { readonly [Name in keyof Parsers]: ReturnType<Parsers[Name]["parse"]> } {
  assert(input === undefined || isRecord(input), () => `${indicator}() options must be an object`);
  const passed = { ...input };
  const names = Object.keys(parsers);
  for (const name of Object.keys(passed)) {
    assert(
      names.includes(name),
      () =>
        `${indicator}() received an unknown option ${JSON.stringify(name)}; expected ${names.join(", ")}`,
    );
  }
  const parsed = Object.fromEntries(
    Object.entries(parsers).map(([name, parser]) => [
      name,
      parser.parse(passed[name], name, indicator),
    ]),
  );
  /* One checked value per parser, which a mapped type says and `fromEntries` cannot. */
  return parsed as { readonly [Name in keyof Parsers]: ReturnType<Parsers[Name]["parse"]> };
}
