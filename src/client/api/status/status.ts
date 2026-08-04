import { STATUS_PATH } from "../../../constants/endpoints.ts";
import { VeloError } from "../../../errors.ts";
import type { Http, HttpRequestOptions } from "../../../transport/http.ts";

/** The normalized response returned by the status endpoint. */
export type StatusResponse = "ok";

/** The API-status namespace exposed by {@link Velo}. */
export class Status {
  readonly #http: Http;

  constructor(http: Http) {
    this.#http = http;
  }

  /** Checks API connectivity and credentials. */
  async get(options?: HttpRequestOptions): Promise<StatusResponse> {
    const body = await this.#http.text(STATUS_PATH, {}, options);
    if (body.trim() !== "ok") {
      throw new VeloError(`Unexpected ${STATUS_PATH} response`);
    }
    return "ok";
  }
}
