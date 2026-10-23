import { describe, expect, it } from "vitest";

import { VeloError } from "../../errors.ts";
import { decodeLines } from "./lines.ts";

/* Collects what an async iterable yields. */
async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const value of values) collected.push(value);
  return collected;
}

/* Lines that arrive one by one, then fail with `failure` if one is given. */
async function* lines(values: readonly string[], failure?: unknown): AsyncGenerator<string> {
  for (const value of values) yield value;
  if (failure !== undefined) throw failure;
}

/* Reads each line as a number, and a header as no row. */
const numbers = (line: string): number | undefined => {
  if (line === "n") return undefined;
  const value = Number(line);
  if (!Number.isFinite(value)) throw new Error(`not a number: ${line}`);
  return value;
};

describe("decodeLines", () => {
  it("yields what each line decodes to, and skips a line that carries no row", async () => {
    await expect(collect(decodeLines(lines(["n", "1", "2"]), numbers, "/test"))).resolves.toEqual([
      1, 2,
    ]);
  });

  it("labels a line the decoder refuses as a malformed response, keeping the decoder's error", async () => {
    const error = await collect(decodeLines(lines(["n", "1", "x"]), numbers, "/test")).catch(
      (cause: unknown) => cause,
    );

    expect(error).toBeInstanceOf(VeloError);
    expect((error as VeloError).message).toBe("Unexpected /test response");
    expect(((error as VeloError).cause as Error).message).toBe("not a number: x");
  });

  it("lets a failure reading the lines through as it was, unlabelled", async () => {
    const aborted = new Error("caller stopped");

    await expect(collect(decodeLines(lines(["n", "1"], aborted), numbers, "/test"))).rejects.toBe(
      aborted,
    );
  });
});
