import { describe, expect, it } from "vitest";

import { VeloError } from "../../errors.ts";
import type { ProductKey } from "./product-key.ts";
import { formatProductKey, parseProductKey } from "./product-key.ts";

describe("rows product keys", () => {
  it("formats an exchange and product", () => {
    const key = formatProductKey("binance", "BTCUSDT");

    expect(key).toBe("binance:BTCUSDT");
  });

  it("parses on the first colon", () => {
    const key = formatProductKey("hyperliquid", "xyz:TSLA");

    expect(key).toBe("hyperliquid:xyz:TSLA");
    expect(parseProductKey(key)).toEqual({ exchange: "hyperliquid", product: "xyz:TSLA" });
  });

  it("rejects invalid runtime values", () => {
    expect(() => formatProductKey("", "BTCUSDT")).toThrow(VeloError);
    expect(() => formatProductKey("bad:exchange", "BTCUSDT")).toThrow(VeloError);
    expect(() => formatProductKey("binance", "")).toThrow(VeloError);
    expect(() => parseProductKey("binance" as ProductKey)).toThrow(VeloError);
    expect(() => parseProductKey(":BTCUSDT" as ProductKey)).toThrow(VeloError);
    expect(() => parseProductKey("binance:" as ProductKey)).toThrow(VeloError);
  });
});
