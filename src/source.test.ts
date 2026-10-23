import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const ROOT = new URL("../", import.meta.url);

/**
 * Lists every TypeScript file the repository keeps.
 *
 * @returns Each file's path from the repository root: all of `src/` and
 * `test/`, and the configuration files beside them.
 */
function sourceFiles(): string[] {
  const inTrees = ["src/", "test/"].flatMap((tree) =>
    (readdirSync(new URL(tree, ROOT), { recursive: true }) as string[]).map(
      (file) => `${tree}${file}`,
    ),
  );
  return [...inTrees, ...readdirSync(ROOT)].filter((file) => file.endsWith(".ts"));
}

describe("source files", () => {
  it("keeps every TypeScript file free of control bytes, so changes stay reviewable", () => {
    /*
     * A pattern or a test string written with the characters themselves in
     * place of their escapes makes git treat the file as binary and hide its
     * diffs. It has happened to the pattern in `src/client/channel/name.ts`
     * twice.
     */
    const files = sourceFiles();
    const offenders = files.filter((file) =>
      readFileSync(new URL(file, ROOT)).some(
        (byte) => byte < 9 || (byte > 13 && byte < 32) || byte === 127,
      ),
    );

    expect(offenders).toEqual([]);
    /* The scan reaches each place a file can be, so an empty result means what it says. */
    expect(files).toEqual(
      expect.arrayContaining([
        "src/client/channel/name.ts",
        "src/transport/websocket.ts",
        "src/index.ts",
        "test/channels.ts",
        "vitest.config.ts",
      ]),
    );
  });
});
