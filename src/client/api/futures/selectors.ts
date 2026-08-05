import type { FuturesStandardColumn } from "../../market/columns.ts";

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
  volume: {
    coin: {
      total: "coin_volume",
      buy: "buy_coin_volume",
      sell: "sell_coin_volume",
    },
    dollar: {
      total: "dollar_volume",
      buy: "buy_dollar_volume",
      sell: "sell_dollar_volume",
    },
  },
  trades: {
    buy: "buy_trades",
    sell: "sell_trades",
    total: "total_trades",
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
  fundingRate: {
    rate: "funding_rate",
    average: "funding_rate_avg",
  },
  premium: "premium",
  liquidations: {
    buy: "buy_liquidations",
    sell: "sell_liquidations",
  },
  liquidationVolume: {
    coin: {
      buy: "buy_liquidations_coin_volume",
      sell: "sell_liquidations_coin_volume",
      total: "liquidations_coin_volume",
    },
    dollar: {
      buy: "buy_liquidations_dollar_volume",
      sell: "sell_liquidations_dollar_volume",
      total: "liquidations_dollar_volume",
    },
  },
} as const satisfies Record<string, FuturesSelectorColumnTree>;

type FuturesSelectors = typeof FUTURES_SELECTOR_COLUMNS;

/** Price components selectable by the futures fluent query builder. */
export type FuturesPricePart = keyof FuturesSelectors["price"];

export type FuturesPriceColumn<P extends FuturesPricePart = FuturesPricePart> =
  FuturesSelectors["price"][P];

/** Volume components selectable by the futures fluent query builder. */
export type FuturesVolumePart = keyof FuturesSelectors["volume"][FuturesVolumeMetric];

/** Unit used for futures volume columns. */
export type FuturesVolumeMetric = keyof FuturesSelectors["volume"];

export type FuturesVolumeColumn<
  M extends FuturesVolumeMetric = FuturesVolumeMetric,
  P extends FuturesVolumePart = FuturesVolumePart,
> = FuturesSelectors["volume"][M][P];

/** Trade-count components selectable by the futures fluent query builder. */
export type FuturesTradePart = keyof FuturesSelectors["trades"];

export type FuturesTradeColumn<P extends FuturesTradePart = FuturesTradePart> =
  FuturesSelectors["trades"][P];

/** Unit used for open-interest columns. */
export type FuturesOpenInterestMetric = keyof FuturesSelectors["openInterest"];

/** Open-interest components selectable by the futures fluent query builder. */
export type FuturesOpenInterestPart =
  keyof FuturesSelectors["openInterest"][FuturesOpenInterestMetric];

export type FuturesOpenInterestColumn<
  M extends FuturesOpenInterestMetric = FuturesOpenInterestMetric,
  P extends FuturesOpenInterestPart = FuturesOpenInterestPart,
> = FuturesSelectors["openInterest"][M][P];

/** Funding-rate components selectable by the futures fluent query builder. */
export type FuturesFundingRatePart = keyof FuturesSelectors["fundingRate"];

export type FuturesFundingRateColumn<P extends FuturesFundingRatePart = FuturesFundingRatePart> =
  FuturesSelectors["fundingRate"][P];

export type FuturesPremiumColumn = FuturesSelectors["premium"];

/** Liquidation-count components selectable by the futures fluent query builder. */
export type FuturesLiquidationPart = keyof FuturesSelectors["liquidations"];

export type FuturesLiquidationColumn<P extends FuturesLiquidationPart = FuturesLiquidationPart> =
  FuturesSelectors["liquidations"][P];

/** Unit used for futures liquidation-volume columns. */
export type FuturesLiquidationVolumeMetric = keyof FuturesSelectors["liquidationVolume"];

/** Liquidation-volume components selectable by the futures fluent query builder. */
export type FuturesLiquidationVolumePart =
  keyof FuturesSelectors["liquidationVolume"][FuturesLiquidationVolumeMetric];

export type FuturesLiquidationVolumeColumn<
  M extends FuturesLiquidationVolumeMetric = FuturesLiquidationVolumeMetric,
  P extends FuturesLiquidationVolumePart = FuturesLiquidationVolumePart,
> = FuturesSelectors["liquidationVolume"][M][P];
