import { fundingRate } from "./indicators/funding-rate.ts";
import { liquidations } from "./indicators/liquidations.ts";
import { openInterest } from "./indicators/open-interest.ts";
import { premium } from "./indicators/premium.ts";
import { price } from "./indicators/price.ts";
import { raw } from "./indicators/raw.ts";
import { spotTape } from "./indicators/spot-tape.ts";
import { spotVolume } from "./indicators/spot-volume.ts";
import { tape } from "./indicators/tape.ts";
import { volume } from "./indicators/volume.ts";

/**
 * Standalone channel construction, spelled like the history builders.
 *
 * A builder's target and options pick which of an indicator's channels comes
 * back, and so its kind: a product for a single channel or a coin, such as
 * `{ coin: "BTC" }`, for one aggregated across exchanges, then a metric.
 */
export const channel = Object.freeze({
  raw,
  price,
  openInterest,
  fundingRate,
  volume,
  tape,
  spotVolume,
  spotTape,
  premium,
  liquidations,
});
