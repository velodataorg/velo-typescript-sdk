import { z } from "zod";

import { byMetric } from "../../builder/selection.ts";
import { FUTURES_EXCHANGES } from "../../market/exchanges.ts";
import type { FuturesExchange } from "../../market/exchanges.ts";
import type { Product } from "../../market/product.ts";
import { defineChannel } from "../define.ts";

type Metric = keyof typeof OPEN_INTEREST;
type OpenInterestChannel<M extends Metric> = ReturnType<(typeof OPEN_INTEREST)[M]>;

/**
 * The live dollar open interest of one futures product.
 *
 * @param product - The product to subscribe to, as the futures catalog returns it.
 * @returns A frozen channel of kind `open_interest_dollar`.
 * @throws A VeloError when the product is not a usable futures product.
 */
export function openInterest(product: Product<FuturesExchange>): OpenInterestChannel<"dollar">;
/**
 * The live open interest of one futures product, in one metric.
 *
 * @remarks
 * Spelled like the history builder's `openInterest(..., { metric })`, and
 * each frame decodes to the one-minute candle in progress as a history row of
 * that metric's high, low, and close, so a caller can seed from history and
 * continue from live by upserting on `time`.
 *
 * The two metrics are different kinds of channel, `open_interest_coin` and
 * `open_interest_dollar`, because they fill different columns; a listener
 * narrows `data` on `kind`.
 *
 * With `coin`, the last row of a minute equals its history row. With
 * `dollar`, high and low do and close does not: a live close is the coin
 * close valued at the last trade price, sent again on every price change, so
 * it can lie outside the candle's high and low. History values each sample at
 * the mark price the exchange reported with it. The two differ by a few
 * hundredths of a percent; once a minute has closed, its history row is the
 * settled value.
 *
 * @param product - The product to subscribe to, as the futures catalog returns it.
 * @param options - Selects the metric. Defaults to `dollar`, as history does.
 * @returns A frozen channel of the metric's kind.
 * @throws A VeloError when the product is not a usable futures product or
 * the metric is unknown.
 */
export function openInterest<M extends Metric>(
  product: Product<FuturesExchange>,
  options: { readonly metric: M },
): OpenInterestChannel<M>;
export function openInterest(
  product: Product<FuturesExchange>,
  options?: { readonly metric: Metric },
): OpenInterestChannel<Metric> {
  return byMetric("openInterest", OPEN_INTEREST, options)(product);
}

/* Both channels send the one-minute candle in progress: high, low, then close. */
const candle = z.tuple([z.number(), z.number(), z.number()]);

/* A new frame arrives when the exchange reports a value, every one to a few seconds. */
const coinOpenInterest = defineChannel("product", {
  kind: "open_interest_coin",
  exchanges: FUTURES_EXCHANGES,
  suffix: "#open_interest#Coins",
  payload: candle,
  columns: ([high, low, close]) => ({
    coin_open_interest_high: high,
    coin_open_interest_low: low,
    coin_open_interest_close: close,
  }),
});

/* The server recomputes close as coin close times last trade price on every price change. */
const dollarOpenInterest = defineChannel("product", {
  kind: "open_interest_dollar",
  exchanges: FUTURES_EXCHANGES,
  suffix: "#open_interest#Dollars",
  payload: candle,
  columns: ([high, low, close]) => ({
    dollar_open_interest_high: high,
    dollar_open_interest_low: low,
    dollar_open_interest_close: close,
  }),
});

const OPEN_INTEREST = { coin: coinOpenInterest, dollar: dollarOpenInterest } as const;
