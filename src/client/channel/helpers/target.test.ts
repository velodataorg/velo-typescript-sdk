import { describe, expect, expectTypeOf, it } from "vitest";

import { VeloError } from "../../../errors.ts";
import type { Product } from "../../market/product.ts";
import { parseProduct, parseTarget } from "./target.ts";
import type { Coin, Target } from "./target.ts";

const BUILDER = "channel.example";
const EXCHANGES = ["bybit", "deribit"] as const;
const BTC = { exchange: "bybit", coin: "BTC", product: "BTCUSDT" } as const;

describe("parseProduct", () => {
  it("snapshots the three fields, frozen, dropping what a catalog row adds", () => {
    const listed = { ...BTC, begin: 0, depth: true };
    const product = parseProduct(BUILDER, EXCHANGES, listed);

    expectTypeOf(product).toEqualTypeOf<Product<"bybit" | "deribit">>();
    expect(product).toEqual(BTC);
    expect(product).not.toBe(listed);
    expect(Object.isFrozen(product)).toBe(true);
  });

  it.each([null, undefined, "BTCUSDT", 42, []])("rejects what is not an object: %j", (input) => {
    expect(() => parseProduct(BUILDER, EXCHANGES, input)).toThrow(
      "channel.example() takes a product, as the catalog returns it",
    );
  });

  it("names the exchange it cannot use", () => {
    expect(() => parseProduct(BUILDER, EXCHANGES, { ...BTC, exchange: "binance" })).toThrow(
      'channel.example() received an invalid exchange "binance"',
    );
    expect(() => parseProduct(BUILDER, EXCHANGES, { coin: "BTC" })).toThrow(
      "channel.example() received an invalid exchange undefined",
    );
  });

  it.each([
    { ...BTC, coin: "" },
    { ...BTC, coin: 42 },
    { ...BTC, product: "" },
    { exchange: "bybit", coin: "BTC" },
    { exchange: "bybit", product: "BTCUSDT" },
  ])("rejects a product missing a usable field: %j", (input) => {
    expect(() => parseProduct(BUILDER, EXCHANGES, input)).toThrow(VeloError);
  });
});

describe("parseTarget", () => {
  it("reads a product as a single target and a coin as an aggregated one", () => {
    expect(parseTarget(BUILDER, EXCHANGES, BTC)).toEqual({ scope: "single", product: BTC });
    expect(parseTarget(BUILDER, EXCHANGES, { coin: "BTC" })).toEqual({
      scope: "aggregated",
      coin: "BTC",
    });
    /* Coin symbols are not limited to ASCII. */
    expect(parseTarget(BUILDER, EXCHANGES, { coin: "币安人生" })).toEqual({
      scope: "aggregated",
      coin: "币安人生",
    });
  });

  it("reads a target naming an exchange or a product as a product, never as its coin", () => {
    /* A product missing a field is refused rather than followed across every exchange. */
    expect(() => parseTarget(BUILDER, EXCHANGES, { exchange: "bybit", coin: "BTC" })).toThrow(
      "channel.example() takes a product whose product is a non-empty string",
    );
    expect(() => parseTarget(BUILDER, EXCHANGES, { coin: "BTC", product: "BTCUSDT" })).toThrow(
      "channel.example() received an invalid exchange undefined",
    );
  });

  it.each([null, undefined, "BTC", 42, []])("rejects what is not an object: %j", (input) => {
    expect(() => parseTarget(BUILDER, EXCHANGES, input)).toThrow(
      'channel.example() takes a product, as the catalog returns it, or a coin, such as { coin: "BTC" }',
    );
  });

  it.each([{}, { coin: "" }, { coin: 42 }, { coins: ["BTC"] }])(
    "rejects a coin without a usable symbol: %j",
    (input) => {
      expect(() => parseTarget(BUILDER, EXCHANGES, input)).toThrow(
        "channel.example() takes a coin whose coin is a non-empty string",
      );
    },
  );

  it("keeps a product and a coin apart for the compiler", () => {
    expectTypeOf<typeof BTC>().toMatchTypeOf<Target<"bybit">>();
    expectTypeOf<{ coin: string }>().toMatchTypeOf<Coin>();
    expectTypeOf<typeof BTC>().not.toMatchTypeOf<Coin>();
    expectTypeOf<{ exchange: "bybit"; coin: string }>().not.toMatchTypeOf<Target<"bybit">>();
  });
});
