import type { OptionsColumn } from "../../common/market/columns.js";

type OptionsSelectorColumnTree =
  | OptionsColumn
  | { readonly [key: string]: OptionsSelectorColumnTree };

/** Raw options columns grouped by the fluent selectors that expose them. */
export const OPTIONS_SELECTOR_COLUMNS = {
  iv: {
    "1w": "iv_1w",
    "1m": "iv_1m",
    "3m": "iv_3m",
    "6m": "iv_6m",
  },
  skew: {
    "1w": "skew_1w",
    "1m": "skew_1m",
    "3m": "skew_3m",
    "6m": "skew_6m",
  },
  vega: {
    coin: "vega_coins",
    dollar: "vega_dollars",
  },
  delta: {
    coin: {
      call: "call_delta_coins",
      put: "put_delta_coins",
    },
    dollar: {
      call: "call_delta_dollars",
      put: "put_delta_dollars",
    },
  },
  gamma: {
    coin: "gamma_coins",
    dollar: "gamma_dollars",
  },
  volume: {
    call: "call_volume",
    put: "put_volume",
  },
  dollarVolume: "dollar_volume",
  premium: {
    call: "call_premium",
    put: "put_premium",
  },
  notional: {
    call: "call_notional",
    put: "put_notional",
  },
  dvol: {
    open: "dvol_open",
    high: "dvol_high",
    low: "dvol_low",
    close: "dvol_close",
  },
  indexPrice: "index_price",
} as const satisfies Record<string, OptionsSelectorColumnTree>;

type OptionsSelectors = typeof OPTIONS_SELECTOR_COLUMNS;

/** Tenors selectable by the options IV selector. */
export type OptionsIvTenor = keyof OptionsSelectors["iv"];

export type OptionsIvColumn<T extends OptionsIvTenor = OptionsIvTenor> = OptionsSelectors["iv"][T];

/** Tenors selectable by the options skew selector. */
export type OptionsSkewTenor = keyof OptionsSelectors["skew"];

export type OptionsSkewColumn<T extends OptionsSkewTenor = OptionsSkewTenor> =
  OptionsSelectors["skew"][T];

/** Unit used for options vega columns. */
export type OptionsVegaMetric = keyof OptionsSelectors["vega"];

export type OptionsVegaColumn<M extends OptionsVegaMetric = OptionsVegaMetric> =
  OptionsSelectors["vega"][M];

/** Option side selectable by the delta selector. */
export type OptionsDeltaPart = keyof OptionsSelectors["delta"][OptionsDeltaMetric];

/** Unit used for options delta columns. */
export type OptionsDeltaMetric = keyof OptionsSelectors["delta"];

export type OptionsDeltaColumn<
  M extends OptionsDeltaMetric = OptionsDeltaMetric,
  P extends OptionsDeltaPart = OptionsDeltaPart,
> = OptionsSelectors["delta"][M][P];

/** Unit used for options gamma columns. */
export type OptionsGammaMetric = keyof OptionsSelectors["gamma"];

export type OptionsGammaColumn<M extends OptionsGammaMetric = OptionsGammaMetric> =
  OptionsSelectors["gamma"][M];

/** Option side selectable by the volume selector. */
export type OptionsVolumePart = keyof OptionsSelectors["volume"];

export type OptionsVolumeColumn<P extends OptionsVolumePart = OptionsVolumePart> =
  OptionsSelectors["volume"][P];

export type OptionsDollarVolumeColumn = OptionsSelectors["dollarVolume"];

/** Option side selectable by the premium selector. */
export type OptionsPremiumPart = keyof OptionsSelectors["premium"];

export type OptionsPremiumColumn<P extends OptionsPremiumPart = OptionsPremiumPart> =
  OptionsSelectors["premium"][P];

/** Option side selectable by the notional selector. */
export type OptionsNotionalPart = keyof OptionsSelectors["notional"];

export type OptionsNotionalColumn<P extends OptionsNotionalPart = OptionsNotionalPart> =
  OptionsSelectors["notional"][P];

/** Price components selectable by the DVOL selector. */
export type OptionsDvolPart = keyof OptionsSelectors["dvol"];

export type OptionsDvolColumn<P extends OptionsDvolPart = OptionsDvolPart> =
  OptionsSelectors["dvol"][P];

export type OptionsIndexPriceColumn = OptionsSelectors["indexPrice"];
