/**
 * Whether a string is one of a list's members.
 *
 * @param list - The members.
 * @param value - The candidate.
 * @returns Whether `value` is listed.
 */
export function isListed<Member extends string>(
  list: readonly Member[],
  value: string,
): value is Member {
  const members: readonly string[] = list;
  return members.includes(value);
}
