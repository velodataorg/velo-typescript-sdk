// Enum values from the Velo API (velo-docs/openapi.json).
// Update by hand when the API adds exchanges, columns, or resolutions.

export const BASE_URL = "https://api.velo.xyz";

export const PRODUCT_TYPES = ["futures", "options", "spot"] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export const EXCHANGES = [
  "binance",
  "binance-coin-margin",
  "binance-futures",
  "bybit",
  "bybit-coin-margin",
  "bybit-spot",
  "coinbase",
  "deribit",
  "hyperliquid",
  "hyperliquid-spot",
  "okex",
  "okex-coin-margin",
  "okex-swap",
] as const;
export type Exchange = (typeof EXCHANGES)[number];

export const FUTURES_COLUMNS = [
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
  "3m_basis_ann",
] as const;
export type FuturesColumn = (typeof FUTURES_COLUMNS)[number];

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

export const RESOLUTIONS = [1, 5, 15, 30, 60, 120, 240, 360, 480, 720, 1440, 4320, 10080] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

export const TERMS_COINS = ["BTC", "ETH"] as const;
export type TermsCoin = (typeof TERMS_COINS)[number];
