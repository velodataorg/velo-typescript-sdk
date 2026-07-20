import { Http } from "../transport/http.js";
import type { HttpConfig } from "../transport/http.js";
import type { Caps } from "./caps/caps.js";
import { createCaps } from "./caps/caps.js";

export type VeloConfig = HttpConfig;

export class Velo {
  readonly #http: Http;
  readonly #caps: Caps;

  constructor(config: VeloConfig) {
    this.#http = new Http(config);
    this.#caps = createCaps(this.#http);
  }

  get caps(): Caps {
    return this.#caps;
  }
}
