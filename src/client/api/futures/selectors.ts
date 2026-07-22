import type { FuturesStandardColumn } from "../../common/market/columns.js";

type FuturesSelectorColumnTree =
  | FuturesStandardColumn
  | { readonly [key: string]: FuturesSelectorColumnTree };

/** Raw futures columns grouped by the fluent selectors that expose them. */
export const FUTURES_SELECTOR_COLUMNS = {
  price: {
    open: "open_price",
    high: "high_price",
    low: "low_price",
    close: "close_price",
  },
  openInterest: {
    coin: {
      high: "coin_open_interest_high",
      low: "coin_open_interest_low",
      close: "coin_open_interest_close",
    },
    dollar: {
      high: "dollar_open_interest_high",
      low: "dollar_open_interest_low",
      close: "dollar_open_interest_close",
    },
  },
} as const satisfies Record<string, FuturesSelectorColumnTree>;

type FuturesSelectors = typeof FUTURES_SELECTOR_COLUMNS;

/** Price components selectable by the futures fluent query builder. */
export type FuturesPricePart = keyof FuturesSelectors["price"];

export type FuturesPriceColumn<P extends FuturesPricePart = FuturesPricePart> =
  FuturesSelectors["price"][P];

/** Unit used for open-interest columns. */
export type FuturesOpenInterestMetric = keyof FuturesSelectors["openInterest"];

/** Open-interest components selectable by the futures fluent query builder. */
export type FuturesOpenInterestPart =
  keyof FuturesSelectors["openInterest"][FuturesOpenInterestMetric];

export type FuturesOpenInterestColumn<
  M extends FuturesOpenInterestMetric = FuturesOpenInterestMetric,
  P extends FuturesOpenInterestPart = FuturesOpenInterestPart,
> = FuturesSelectors["openInterest"][M][P];
