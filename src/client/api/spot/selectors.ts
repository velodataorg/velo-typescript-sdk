import type { SpotColumn } from "../../market/columns.ts";

type SpotSelectorColumnTree = SpotColumn | { readonly [key: string]: SpotSelectorColumnTree };

/** Raw spot columns grouped by the fluent selectors that expose them. */
export const SPOT_SELECTOR_COLUMNS = {
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
} as const satisfies Record<string, SpotSelectorColumnTree>;

type SpotSelectors = typeof SPOT_SELECTOR_COLUMNS;

/** Price components selectable by the spot fluent query builder. */
export type SpotPricePart = keyof SpotSelectors["price"];

export type SpotPriceColumn<P extends SpotPricePart = SpotPricePart> = SpotSelectors["price"][P];

/** Unit used for spot volume columns. */
export type SpotVolumeMetric = keyof SpotSelectors["volume"];

/** Volume components selectable by the spot fluent query builder. */
export type SpotVolumePart = keyof SpotSelectors["volume"][SpotVolumeMetric];

export type SpotVolumeColumn<
  M extends SpotVolumeMetric = SpotVolumeMetric,
  P extends SpotVolumePart = SpotVolumePart,
> = SpotSelectors["volume"][M][P];

/** Trade-count components selectable by the spot fluent query builder. */
export type SpotTradePart = keyof SpotSelectors["trades"];

export type SpotTradeColumn<P extends SpotTradePart = SpotTradePart> = SpotSelectors["trades"][P];
