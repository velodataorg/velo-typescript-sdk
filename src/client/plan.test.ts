import { describe, expect, it } from "vitest";

import { VeloError } from "../errors.ts";
import { Velo } from "./client.ts";

function client(): Velo {
  return new Velo({
    apiKey: "test_key",
    fetch: async () => new Response(""),
  });
}

describe("Velo.query", () => {
  it("rejects a malformed request envelope with a VeloError", () => {
    const velo = client();

    expect(() => velo.query(null as never)).toThrow(VeloError);
    expect(() => velo.query(null as never)).toThrow(/query request must be an object/);
    expect(() => velo.query({ kind: 42, params: {} } as never)).toThrow(
      /query request kind must be a string/,
    );
    expect(() => velo.query({ kind: "orderbook.levels" } as never)).toThrow(
      /query request must include params/,
    );
  });

  it("rejects an unknown query kind with a contextual VeloError", () => {
    const velo = client();
    const create = () => velo.query({ kind: "unknown", params: {} } as never);

    expect(create).toThrow(VeloError);
    expect(create).toThrow('Unknown query kind "unknown"');
  });

  it("delegates known request params to the endpoint planner", () => {
    const velo = client();

    expect(() => velo.query({ kind: "orderbook.levels", params: {} } as never)).toThrow(
      /Invalid orderbook params/,
    );
  });
});
