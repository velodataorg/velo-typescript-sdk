import type { QueryFactory } from "../../plan.ts";
import { OptionsBuilder } from "./builder.ts";
import { OptionsTermsBuilder, type TermsParams } from "./terms.ts";

/** The options namespace exposed by {@link Velo}. */
export class Options {
  readonly #termsQuery: QueryFactory<"options.terms">;
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

  constructor(query: QueryFactory<"options.rows">, termsQuery: QueryFactory<"options.terms">) {
    this.#termsQuery = termsQuery;
    const builder = new OptionsBuilder(query);
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
  }

  /** Creates an immutable options term-structure builder bound to this client. */
  terms(params: TermsParams): OptionsTermsBuilder {
    return new OptionsTermsBuilder(params, this.#termsQuery);
  }
}
