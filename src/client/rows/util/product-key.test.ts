import { describe, expect, expectTypeOf, it } from "vitest";

import { VeloError } from "../../../errors.js";
import type { ProductKey } from "./product-key.js";
import { formatProductKey, parseProductKey } from "./product-key.js";

describe("rows product keys", () => {
  it("formats an exchange and product", () => {
    const key = formatProductKey("binance", "BTCUSDT");

    expect(key).toBe("binance:BTCUSDT");
    expectTypeOf(key).toEqualTypeOf<ProductKey<"binance">>();
  });

  it("parses on the first colon", () => {
    const key = formatProductKey("hyperliquid", "xyz:TSLA");

    expect(key).toBe("hyperliquid:xyz:TSLA");
    expect(parseProductKey(key)).toEqual({ exchange: "hyperliquid", product: "xyz:TSLA" });
    expectTypeOf(parseProductKey(key).exchange).toEqualTypeOf<"hyperliquid">();
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
