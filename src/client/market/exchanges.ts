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

export const SPOT_EXCHANGES = ["binance", "bybit-spot", "coinbase", "okex"] as const;
export type SpotExchange = (typeof SPOT_EXCHANGES)[number];

export type Exchange = FuturesExchange | OptionsExchange | SpotExchange;
