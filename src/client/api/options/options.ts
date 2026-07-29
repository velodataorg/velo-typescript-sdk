import type { Http } from "../../../transport/http.js";
import { OptionsBuilder } from "./builder.js";
import { OptionsQuery } from "./query.js";
import { TermsQuery } from "./terms.js";

/** The options namespace exposed by {@link Velo}. */
export class Options {
  readonly query: OptionsQuery["build"];
  readonly terms: TermsQuery["build"];
  readonly iv: OptionsBuilder<never>["iv"];
  readonly skew: OptionsBuilder<never>["skew"];
  readonly vega: OptionsBuilder<never>["vega"];
  readonly delta: OptionsBuilder<never>["delta"];
  readonly gamma: OptionsBuilder<never>["gamma"];
  readonly volume: OptionsBuilder<never>["volume"];
  readonly dollarVolume: OptionsBuilder<never>["dollarVolume"];
  readonly premium: OptionsBuilder<never>["premium"];
  readonly notional: OptionsBuilder<never>["notional"];
  readonly dvol: OptionsBuilder<never>["dvol"];
  readonly indexPrice: OptionsBuilder<never>["indexPrice"];
  readonly exchanges: OptionsBuilder<never>["exchanges"];

  constructor(http: Http) {
    const query = new OptionsQuery(http);
    const terms = new TermsQuery(http);
    const builder = new OptionsBuilder(query);
    this.query = query.build.bind(query);
    this.terms = terms.build.bind(terms);
    this.iv = builder.iv.bind(builder);
    this.skew = builder.skew.bind(builder);
    this.vega = builder.vega.bind(builder);
    this.delta = builder.delta.bind(builder);
    this.gamma = builder.gamma.bind(builder);
    this.volume = builder.volume.bind(builder);
    this.dollarVolume = builder.dollarVolume.bind(builder);
    this.premium = builder.premium.bind(builder);
    this.notional = builder.notional.bind(builder);
    this.dvol = builder.dvol.bind(builder);
    this.indexPrice = builder.indexPrice.bind(builder);
    this.exchanges = builder.exchanges.bind(builder);
  }
}
