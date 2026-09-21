import type { Channel } from "../../channel/channel.ts";
import { fundingRate } from "../../channel/indicators/funding-rate.ts";
import { liquidationVolume } from "../../channel/indicators/liquidation-volume.ts";
import { liquidations } from "../../channel/indicators/liquidations.ts";
import { openInterest } from "../../channel/indicators/open-interest.ts";
import { premium } from "../../channel/indicators/premium.ts";
import { price } from "../../channel/indicators/price.ts";
import { raw } from "../../channel/indicators/raw.ts";
import { spotTape } from "../../channel/indicators/spot-tape.ts";
import { spotVolume } from "../../channel/indicators/spot-volume.ts";
import { tape } from "../../channel/indicators/tape.ts";
import { volume } from "../../channel/indicators/volume.ts";
import { ChannelsFeedBuilder } from "./builder.ts";

/**
 * The channels namespace exposed by {@link Velo}.
 *
 * Its builders are spelled like the history ones. A builder's target and
 * options pick which of an indicator's channels comes back, and so its kind:
 * a product for a single channel or a coin, such as `{ coin: "BTC" }`, for
 * one aggregated across exchanges, then a metric. What they build goes into
 * `feed()`.
 */
export class Channels {
  readonly raw = raw;
  readonly price = price;
  readonly openInterest = openInterest;
  readonly fundingRate = fundingRate;
  readonly volume = volume;
  readonly tape = tape;
  readonly spotVolume = spotVolume;
  readonly spotTape = spotTape;
  readonly premium = premium;
  readonly liquidations = liquidations;
  readonly liquidationVolume = liquidationVolume;

  /**
   * Creates an immutable live-feed builder for a set of channels.
   *
   * @param channels - Channels built on this namespace. A bare wire name goes
   * through `raw()`.
   * @returns A builder whose request carries the channels' types.
   */
  feed<const C extends Channel>(channels: readonly C[]): ChannelsFeedBuilder<C> {
    return new ChannelsFeedBuilder(channels);
  }
}
