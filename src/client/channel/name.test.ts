import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { channelEndpoint } from "./name.ts";

describe("channel names", () => {
  it("routes by the name's source", () => {
    expect(channelEndpoint("realtime_BTC#premium#Aggregated")).toBe("realtime");
    expect(channelEndpoint("ondemand_hyperliquid_spot_UBTC-USDC_candle_1")).toBe("ondemand");
  });

  it("keeps every source file free of control bytes, so changes stay reviewable", () => {
    /*
     * A pattern or a test string written with the characters themselves in
     * place of their escapes makes git treat the file as binary and hide its
     * diffs. It has happened to the name pattern twice.
     */
    const root = new URL("../../", import.meta.url);
    const offenders = (readdirSync(root, { recursive: true }) as string[])
      .filter((file) => file.endsWith(".ts"))
      .filter((file) =>
        readFileSync(new URL(file, root)).some(
          (byte) => byte < 9 || (byte > 13 && byte < 32) || byte === 127,
        ),
      );
    expect(offenders).toEqual([]);
  });
});
