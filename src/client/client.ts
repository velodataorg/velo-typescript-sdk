import { Http } from "../transport/http.js";
import type { HttpConfig } from "../transport/http.js";
import type { Caps } from "./caps/caps.js";
import { createCaps } from "./caps/caps.js";
import type { Futures } from "./rows/futures.js";
import { createFutures } from "./rows/futures.js";
import type { Options } from "./rows/options.js";
import { createOptions } from "./rows/options.js";
import type { Spot } from "./rows/spot.js";
import { createSpot } from "./rows/spot.js";

export type VeloConfig = HttpConfig;

export class Velo {
  readonly #http: Http;
  readonly #caps: Caps;
  readonly #futures: Futures;
  readonly #options: Options;
  readonly #spot: Spot;

  constructor(config: VeloConfig) {
    this.#http = new Http(config);
    this.#caps = createCaps(this.#http);
    this.#futures = createFutures(this.#http);
    this.#options = createOptions(this.#http);
    this.#spot = createSpot(this.#http);
  }

  get caps(): Caps {
    return this.#caps;
  }

  get futures(): Futures {
    return this.#futures;
  }

  get options(): Options {
    return this.#options;
  }

  get spot(): Spot {
    return this.#spot;
  }
}
