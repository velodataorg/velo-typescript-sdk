import { describe, expect, expectTypeOf, it } from "vitest";

import { channels } from "../../index.ts";
import type { Channel, ChannelError, ChannelFrame, ChannelMessage } from "../../index.ts";
import { isChannel, listenersOf } from "./create.ts";

const BTC = { exchange: "binance-futures", coin: "BTC", product: "BTCUSDT" } as const;

describe("a channel's on()", () => {
  it("returns a new frozen channel that carries the listeners, and leaves the first alone", () => {
    const price = channels.price(BTC);
    const data = (): void => {};
    const listened = price.on({ data });

    expect(listened).not.toBe(price);
    expect(Object.isFrozen(listened)).toBe(true);
    expect([listened.kind, listened.name, listened.decode]).toEqual([
      price.kind,
      price.name,
      price.decode,
    ]);
    expect(listenersOf(listened)).toEqual({ data });
    expect(listenersOf(price)).toEqual({});
    expect(Object.isFrozen(listenersOf(listened))).toBe(true);
  });

  it("keeps the listeners out of the channel's own fields", () => {
    const listened = channels.price(BTC).on({ data: () => {} });

    expect(Object.keys(listened).sort()).toEqual(["decode", "kind", "name", "on"]);
  });

  it("types each listener by the channel alone", () => {
    channels.openInterest(BTC, { metric: "coins" }).on({
      data: (row, message) => {
        expectTypeOf(row.coin_open_interest_close).toEqualTypeOf<number | null>();
        expectTypeOf(row.time).toEqualTypeOf<number>();
        expectTypeOf(message.kind).toEqualTypeOf<"open_interest_coins">();
        // @ts-expect-error coins were asked for
        void row.dollar_open_interest_close;
      },
      error: (event) => expectTypeOf(event).toEqualTypeOf<ChannelError>(),
    });
    channels.fundingRate({ coin: "BTC" }, { weighted: true }).on({
      data: (entries) => {
        expectTypeOf(entries[0]!.coin_open_interest_close).toEqualTypeOf<number | null>();
        // @ts-expect-error an entry cannot be placed in a minute
        void entries[0]!.time;
      },
    });
    channels.raw("realtime_BTC#vwap").on({
      data: (payload, message) => {
        expectTypeOf(payload).toEqualTypeOf<unknown>();
        expectTypeOf(message).toEqualTypeOf<ChannelMessage<Channel<"raw", unknown>>>();
      },
    });
  });

  it("keeps a channel's type, so it chains and still goes into a feed", () => {
    const listened = channels.tape(BTC).on({ data: () => {} });

    const plain = channels.tape(BTC);
    expectTypeOf(listened).toEqualTypeOf<typeof plain>();
    expectTypeOf(listened.on({ error: () => {} })).toEqualTypeOf<typeof plain>();

    /* A feed takes channels of any kind together: a listener's own types never block one. */
    const fed = channels.feed([listened, channels.price(BTC).on({ data: () => {} })]);
    expect(fed.build().params.channels.map((channel) => channel.kind)).toEqual(["tape", "price"]);
  });

  it("adds a second kind of listener, and refuses the same kind twice", () => {
    const data = (): void => {};
    const error = (): void => {};
    const listened = channels.price(BTC).on({ data }).on({ error });

    expect(listenersOf(listened)).toEqual({ data, error });
    expect(() => listened.on({ data })).toThrow(
      "realtime_binance-futures:BTCUSDT already has a data listener",
    );
  });

  it("refuses anything but functions under the two listener names", () => {
    const price = channels.price(BTC);

    // @ts-expect-error listeners are an object
    expect(() => price.on(() => {})).toThrow("on() takes an object of listeners");
    // @ts-expect-error a channel has no such listener
    expect(() => price.on({ decodeError: () => {} })).toThrow(
      'on() received an unknown listener "decodeError"; expected data, error',
    );
    // @ts-expect-error a listener is a function
    expect(() => price.on({ data: "log" })).toThrow("on() takes a function for data");
  });
});

describe("what counts as a channel", () => {
  it("is what the namespace built, and never an object written by hand", () => {
    const written = { kind: "mine", name: "realtime_x", decode: (frame: ChannelFrame) => frame.d };

    expect(isChannel(channels.price(BTC))).toBe(true);
    expect(isChannel(channels.price(BTC).on({ data: () => {} }))).toBe(true);
    expect(isChannel(channels.custom(written))).toBe(true);
    expect(isChannel(written)).toBe(false);
    expect(isChannel({ ...channels.price(BTC) })).toBe(false);
    expect(isChannel(null)).toBe(false);
  });
});
