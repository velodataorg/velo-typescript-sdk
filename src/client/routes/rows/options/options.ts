import type { Http } from "../../../../transport/http.js";
import { TermsQuery } from "../../terms/terms-query.js";
import { OptionsQuery } from "./options-query.js";

/** The options namespace exposed by {@link Velo}. */
export class Options {
  readonly query: OptionsQuery["build"];
  readonly terms: TermsQuery["build"];

  constructor(http: Http) {
    const query = new OptionsQuery(http);
    const terms = new TermsQuery(http);
    this.query = query.build.bind(query);
    this.terms = terms.build.bind(terms);
  }
}
