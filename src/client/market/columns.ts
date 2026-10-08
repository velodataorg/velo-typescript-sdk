export const FUTURES_STANDARD_COLUMNS = [
  "open_price",
  "high_price",
  "low_price",
  "close_price",
  "coin_volume",
  "dollar_volume",
  "buy_trades",
  "sell_trades",
  "total_trades",
  "buy_coin_volume",
  "sell_coin_volume",
  "buy_dollar_volume",
  "sell_dollar_volume",
  "coin_open_interest_high",
  "coin_open_interest_low",
  "coin_open_interest_close",
  "dollar_open_interest_high",
  "dollar_open_interest_low",
  "dollar_open_interest_close",
  "funding_rate",
  "funding_rate_avg",
  "premium",
  "buy_liquidations",
  "sell_liquidations",
  "buy_liquidations_coin_volume",
  "sell_liquidations_coin_volume",
  "liquidations_coin_volume",
  "buy_liquidations_dollar_volume",
  "sell_liquidations_dollar_volume",
  "liquidations_dollar_volume",
] as const;

export const BASIS_COLUMN = "3m_basis_ann";
export const FUTURES_COLUMNS = [...FUTURES_STANDARD_COLUMNS, BASIS_COLUMN] as const;

export type FuturesColumn = (typeof FUTURES_COLUMNS)[number];
export type FuturesStandardColumn = (typeof FUTURES_STANDARD_COLUMNS)[number];

export const OPTIONS_COLUMNS = [
  "iv_1w",
  "iv_1m",
  "iv_3m",
  "iv_6m",
  "skew_1w",
  "skew_1m",
  "skew_3m",
  "skew_6m",
  "vega_coins",
  "vega_dollars",
  "call_delta_coins",
  "call_delta_dollars",
  "put_delta_coins",
  "put_delta_dollars",
  "gamma_coins",
  "gamma_dollars",
  "call_volume",
  "call_premium",
  "call_notional",
  "put_volume",
  "put_premium",
  "put_notional",
  "dollar_volume",
  "dvol_open",
  "dvol_high",
  "dvol_low",
  "dvol_close",
  "index_price",
] as const;

export type OptionsColumn = (typeof OPTIONS_COLUMNS)[number];

export const SPOT_COLUMNS = [
  "open_price",
  "high_price",
  "low_price",
  "close_price",
  "coin_volume",
  "dollar_volume",
  "buy_trades",
  "sell_trades",
  "total_trades",
  "buy_coin_volume",
  "sell_coin_volume",
  "buy_dollar_volume",
  "sell_dollar_volume",
] as const;

export type SpotColumn = (typeof SPOT_COLUMNS)[number];

/*
 * What the server publishes live and history has no column for: what funding
 * spends, in coins and in dollars. The only column names that are the SDK's
 * own rather than the history API's.
 */
export type LiveOnlyColumn = "coin_funding_spend_rate" | "dollar_funding_spend_rate";

/* A column a channel's data may carry: a history column, or one only live data has. */
export type ChannelColumn = FuturesStandardColumn | SpotColumn | LiveOnlyColumn;
