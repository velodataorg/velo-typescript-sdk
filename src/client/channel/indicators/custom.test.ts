import { describe, expect, expectTypeOf, it } from "vitest";

import { channels, VeloError } from "../../../index.ts";
import type { Channel, ChannelFrame } from "../../../index.ts";

const NAME = "realtime_binance-futures:BTCUSDT#vwap";

describe("channels.custom", () => {
  it("builds a frozen channel of the caller's kind and data", () => {
    const vwap = channels.custom({
      kind: "vwap",
      name: NAME,
      decode: (frame: ChannelFrame): { readonly volume: number } => ({ volume: Number(frame.d) }),
    });

    expectTypeOf(vwap).toEqualTypeOf<Channel<"vwap", { readonly volume: number }>>();
    expect([vwap.kind, vwap.name]).toEqual(["vwap", NAME]);
    expect(vwap.decode({ c: NAME, d: "3" })).toEqual({ volume: 3 });
    expect(Object.isFrozen(vwap)).toBe(true);
  });

  it("captures the three fields, so changing the object afterwards changes nothing", () => {
    const written = { kind: "count", name: NAME, decode: (): number => 1 };
    const count = channels.custom(written);
    written.kind = "changed";
    written.name = "realtime_other";
    written.decode = () => 2;

    expect([count.kind, count.name, count.decode({ c: NAME })]).toEqual(["count", NAME, 1]);
  });

  it("calls the decoder on the object it was written on", () => {
    const written = {
      kind: "scaled",
      name: NAME,
      factor: 10,
      decode(frame: ChannelFrame): number {
        return Number(frame.d) * this.factor;
      },
    };

    expect(channels.custom(written).decode({ c: NAME, d: 2 })).toBe(20);
  });

  it.each([
    [null, "channels.custom() takes an object of kind, name, and decode"],
    [{ kind: "", name: NAME, decode: (): number => 1 }, "takes a kind that is a non-empty string"],
    [{ kind: "test", name: () => NAME, decode: (): number => 1 }, "takes a name that is a string"],
    [{ kind: "test", name: NAME }, "takes a decode that is a function"],
  ])("refuses %j", (definition, message) => {
    expect(() => channels.custom(definition as never)).toThrow(message);
  });

  it("refuses a wire name the server could not be sent", () => {
    expect(() => channels.custom({ kind: "test", name: "bad\nname", decode: () => 1 })).toThrow(
      VeloError,
    );
  });
});
