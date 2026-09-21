import type { Channel } from "../../channel/channel.ts";
import { custom } from "../../channel/indicators/custom.ts";
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
 * one aggregated across exchanges, then a metric. What they build takes its
 * listeners with `on()` and goes into `feed()`.
 */
export class Channels {
  readonly raw = raw;
  readonly custom = custom;
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
   * @param channels - Channels built on this namespace, each with a `data`
   * listener from `on()`. A bare wire name goes through `raw()`, and a decoder
   * of the caller's own through `custom()`.
   * @returns A builder of the feed's request.
   * @throws A VeloError when the list is empty, holds something that is not
   * a channel, holds a channel with no `data` listener, or holds two that
   * disagree on a kind.
   */
  feed(channels: readonly Channel[]): ChannelsFeedBuilder {
    return new ChannelsFeedBuilder(channels);
  }
}
