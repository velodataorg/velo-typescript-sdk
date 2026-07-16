/* The /rows vocabulary: what the server accepts per market, as
 * velo-api-proxy validates it. Other combinations are rejected with a 400.
 */

export const MARKET_TYPES = ["futures", "options", "spot"] as const;
export type MarketType = (typeof MARKET_TYPES)[number];

/* Exchanges per market, as the server accepts them (velo-api-proxy
 * validExchanges).
 */
export const FUTURES_EXCHANGES = [
  "binance-coin-margin",
  "binance-futures",
  "bybit",
  "bybit-coin-margin",
  "deribit",
  "hyperliquid",
  "okex-coin-margin",
  "okex-swap",
] as const;
export type FuturesExchange = (typeof FUTURES_EXCHANGES)[number];

export const OPTIONS_EXCHANGES = ["deribit"] as const;
export type OptionsExchange = (typeof OPTIONS_EXCHANGES)[number];

export const SPOT_EXCHANGES = [
  "binance",
  "bybit-spot",
  "coinbase",
  "hyperliquid-spot",
  "okex",
] as const;
export type SpotExchange = (typeof SPOT_EXCHANGES)[number];

export type Exchange = FuturesExchange | OptionsExchange | SpotExchange;

/* Union of the per-market lists (deribit serves two markets). */
export const EXCHANGES: readonly Exchange[] = [
  ...new Set([...FUTURES_EXCHANGES, ...OPTIONS_EXCHANGES, ...SPOT_EXCHANGES]),
].sort();

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

export type Column<T extends MarketType> = {
  futures: FuturesColumn;
  options: OptionsColumn;
  spot: SpotColumn;
}[T];

export type MarketExchange<T extends MarketType> = {
  futures: FuturesExchange;
  options: OptionsExchange;
  spot: SpotExchange;
}[T];

/* Value-level counterparts of Column and MarketExchange, for runtime
 * validation of plain-JS input.
 */
export const MARKET_COLUMNS: Record<MarketType, readonly string[]> = {
  futures: FUTURES_COLUMNS,
  options: OPTIONS_COLUMNS,
  spot: SPOT_COLUMNS,
};
export const MARKET_EXCHANGES: Record<MarketType, readonly string[]> = {
  futures: FUTURES_EXCHANGES,
  options: OPTIONS_EXCHANGES,
  spot: SPOT_EXCHANGES,
};
