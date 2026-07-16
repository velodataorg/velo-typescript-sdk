import { describe, expect, it } from "vitest";

import { VeloError } from "../transport/error.js";
import { Velo } from "./client.js";

const ROWS_CSV =
  "exchange,coin,product,time,close_price\n" +
  "binance-futures,BTC,BTCUSDT,1783929600000,63174.9\n" +
  "bybit,BTC,BTCUSDT,1783929600000,63170\n";

/** A Velo client whose fetch returns `body` and records request URLs. */
function velo(body: string, urls: string[] = []) {
  const fetchFn: typeof globalThis.fetch = async (input) => {
    urls.push(String(input));
    return new Response(body, { status: 200 });
  };
  return { velo: new Velo({ apiKey: "test_key", fetch: fetchFn }), urls };
}

function searchParams(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

/** Drain an async iterable into an array (Array.fromAsync needs Node 22; engines allow 20). */
async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) {
    items.push(item);
  }
  return items;
}

describe("Velo.futures.query", () => {
  const params = {
    exchanges: ["binance-futures", "bybit"],
    products: ["BTCUSDT"],
    columns: ["close_price"],
    begin: Date.UTC(2026, 5, 17, 7, 23, 45),
    end: Date.UTC(2026, 5, 17, 9, 0, 0, 1),
    resolution: "1h",
  } as const;

  it("sends nothing until execute, then one aligned request, and parses the rows", async () => {
    const { velo: client, urls } = velo(ROWS_CSV);
    const query = client.futures.query(params);
    expect(urls).toHaveLength(0); // constructing a query is not a request

    const rows = await query.execute();

    expect(rows).toEqual([
      {
        exchange: "binance-futures",
        coin: "BTC",
        product: "BTCUSDT",
        time: 1783929600000,
        close_price: 63174.9,
      },
      {
        exchange: "bybit",
        coin: "BTC",
        product: "BTCUSDT",
        time: 1783929600000,
        close_price: 63170,
      },
    ]);

    expect(urls).toHaveLength(1);
    const url = urls[0] as string;
    expect(url.startsWith("https://api.velo.xyz/api/v1/rows?")).toBe(true);
    const query2 = searchParams(url);
    expect(query2.get("type")).toBe("futures");
    expect(query2.get("exchanges")).toBe("binance-futures,bybit");
    expect(query2.get("products")).toBe("BTCUSDT");
    expect(query2.get("columns")).toBe("close_price");
    expect(query2.get("resolution")).toBe("60");
    expect(query2.get("months")).toBeNull();
    expect(query2.get("coins")).toBeNull();
    // begin floored, end ceiled to the 1h bucket
    expect(query2.get("begin")).toBe(String(Date.UTC(2026, 5, 17, 7)));
    expect(query2.get("end")).toBe(String(Date.UTC(2026, 5, 17, 10)));
  });

  const spotParams = { ...params, exchanges: ["binance", "coinbase"] } as const;

  it("sends the market type of the namespace that created the query", async () => {
    const { velo: client, urls } = velo(ROWS_CSV);
    await client.spot.query(spotParams).execute();

    expect(searchParams(urls[0] as string).get("type")).toBe("spot");
  });

  it("is sealed: neither the caller's arrays nor the snapshot can change the request", async () => {
    const { velo: client, urls } = velo(ROWS_CSV);
    const products = ["BTCUSDT"];
    const columns = ["close_price"] as const;
    const query = client.futures.query({ ...params, products, columns });

    products.push("ETHUSDT"); // would widen the request past what was validated

    // the snapshot is frozen: mutating it throws instead of bypassing validation
    expect(() => (query.params.columns as string[]).push("open_price")).toThrow(TypeError);
    expect(() => {
      // @ts-expect-error the sealed params are read-only
      query.params.begin = 0;
    }).toThrow(TypeError);
    expect(() => {
      // @ts-expect-error params has no setter
      query.params = { ...query.params };
    }).toThrow(TypeError);

    await query.execute();
    const sent = searchParams(urls[0] as string);
    expect(sent.get("products")).toBe("BTCUSDT");
    expect(sent.get("columns")).toBe("close_price");
  });

  it("ignores a stray type in the params; the namespace wins", async () => {
    const { velo: client, urls } = velo(ROWS_CSV);
    // Not a fresh literal, so TypeScript's excess-property check lets the
    // extra `type` through; it must not override the namespace.
    const smuggled = { ...spotParams, type: "futures" };
    await client.spot.query(smuggled).execute();

    expect(searchParams(urls[0] as string).get("type")).toBe("spot");
  });

  it("sends months=true for the 1M resolution", async () => {
    const { velo: client, urls } = velo(ROWS_CSV);
    await client.futures.query({ ...params, resolution: "1M" }).execute();

    const query = searchParams(urls[0] as string);
    expect(query.get("resolution")).toBe("1");
    expect(query.get("months")).toBe("true");
    expect(query.get("begin")).toBe(String(Date.UTC(2026, 5, 1)));
    expect(query.get("end")).toBe(String(Date.UTC(2026, 6, 1)));
  });

  it("parses an empty body (pair with no data) as no rows", async () => {
    const { velo: client } = velo("");
    expect(await client.futures.query(params).execute()).toEqual([]);
  });

  it("rejects invalid params at query construction, before any request", () => {
    const { velo: client, urls } = velo(ROWS_CSV);
    const cases: unknown[] = [
      { ...params, products: undefined }, // no selector
      { ...params, coins: ["BTC"] }, // both selectors
      { ...params, exchanges: [] }, // exchanges required
      { ...params, columns: [] }, // no columns
      { ...params, columns: ["3m_basis_ann", "close_price"] }, // basis not alone
      { ...params, columns: ["3m_basis_ann"] }, // basis needs coins
      { ...params, begin: NaN }, // begin not a timestamp
      { ...params, end: params.begin }, // empty range
      { ...params, end: 1e16 }, // end past the representable date range
      { ...params, resolution: "2m" }, // unknown resolution
      { ...params, columns: ["iv_1w"] }, // options column on futures
      { ...params, exchanges: ["coinbase"] }, // spot exchange on futures
      { ...params, products: "BTCUSDT" }, // selector must be an array, not a string
      { ...params, columns: "close_price" }, // columns must be an array
      { ...params, exchanges: "binance-futures" }, // exchanges must be an array
      { ...params, products: [""] }, // empty selector element
      { ...params, products: Array(1) }, // sparse array hiding an undefined element
    ];
    for (const invalid of cases) {
      expect(() => client.futures.query(invalid as never)).toThrow(VeloError);
    }
    expect(urls).toHaveLength(0);
  });

  it("chunks over-budget ranges into sequential contiguous requests", async () => {
    const urls: string[] = [];
    const fetchFn: typeof globalThis.fetch = async (input) => {
      urls.push(String(input));
      const step = urls.length;
      return new Response(
        `exchange,coin,product,time,close_price\nbinance-futures,BTC,BTCUSDT,${step},${step * 10}\n`,
        { status: 200 },
      );
    };
    const client = new Velo({ apiKey: "test_key", fetch: fetchFn });

    // 30000 one-minute buckets x 1 exchange x 1 product x 1 column -> 2 chunks
    const begin = Date.UTC(2026, 0, 1);
    const rows = await client.futures
      .query({
        exchanges: ["binance-futures"],
        products: ["BTCUSDT"],
        columns: ["close_price"],
        begin,
        end: begin + 30_000 * 60_000,
        resolution: "1m",
      })
      .execute();

    expect(urls).toHaveLength(2);
    const first = searchParams(urls[0] as string);
    const second = searchParams(urls[1] as string);
    expect(first.get("begin")).toBe(String(begin));
    expect(first.get("end")).toBe(String(begin + 22_500 * 60_000));
    expect(second.get("begin")).toBe(first.get("end"));
    expect(second.get("end")).toBe(String(begin + 30_000 * 60_000));
    // chunk results concatenate in request order
    expect(rows.map((row) => row.close_price)).toEqual([10, 20]);
  });

  it("accepts a basis query: coins, no exchanges", async () => {
    const BASIS_CSV =
      "exchange,coin,product,time,3m_basis_ann\n" +
      "deribit,BTC,BTC-25SEP26,1783929600000,0.0395\n";
    const { velo: client, urls } = velo(BASIS_CSV);
    await client.futures
      .query({
        columns: ["3m_basis_ann"],
        coins: ["BTC", "ETH"],
        begin: params.begin,
        end: params.end,
        resolution: "1h",
      })
      .execute();

    const query = searchParams(urls[0] as string);
    expect(query.get("coins")).toBe("BTC,ETH");
    expect(query.get("exchanges")).toBeNull();
    expect(query.get("products")).toBeNull();
  });

  it("rejects a response whose header does not match the requested columns", async () => {
    // header carries open_price, but the request asked for close_price
    const { velo: client } = velo(
      "exchange,coin,product,time,open_price\nbinance-futures,BTC,BTCUSDT,1783929600000,63174.9\n",
    );
    await expect(client.futures.query(params).execute()).rejects.toThrow(
      /unexpected \/api\/v1\/rows response header/,
    );
  });

  it("rejects a response missing the base columns", async () => {
    const { velo: client } = velo("time,close_price\n1783929600000,63174.9\n");
    await expect(client.futures.query(params).execute()).rejects.toThrow(VeloError);
  });

  it("rejects a response whose cells do not match the column types", async () => {
    const { velo: client } = velo(
      "exchange,coin,product,time,close_price\nbinance-futures,BTC,BTCUSDT,not-a-time,not-a-number\n",
    );
    await expect(client.futures.query(params).execute()).rejects.toThrow(
      /column time expected a number/,
    );
  });

  it("keeps a numeric-looking coin a string", async () => {
    const { velo: client } = velo(
      "exchange,coin,product,time,close_price\nbinance-futures,888,888USDT,1783929600000,1\n",
    );
    const rows = await client.futures.query(params).execute();
    expect(rows[0]?.coin).toBe("888");
  });

  it("parses a SQL NULL data value as null, and the row type allows it", async () => {
    const { velo: client } = velo(
      "exchange,coin,product,time,close_price\nbinance-futures,BTC,BTCUSDT,1783929600000,null\n",
    );
    const rows = await client.futures.query(params).execute();

    const price: number | null = rows[0]!.close_price;
    expect(price).toBeNull();
  });

  it("types rows by the requested columns", async () => {
    const { velo: client } = velo(ROWS_CSV);
    const rows = await client.futures.query(params).execute();

    // requested columns are nullable data fields; base columns are not
    const price: number | null = rows[0]!.close_price;
    const time: number = rows[0]!.time;
    expect(price).toBe(63174.9);
    expect(time).toBe(1783929600000);

    // @ts-expect-error open_price was not requested
    const missing = rows[0]!.open_price;
    expect(missing).toBeUndefined();
  });
});

describe("Velo.futures.query stream", () => {
  const params = {
    exchanges: ["binance-futures", "bybit"],
    products: ["BTCUSDT"],
    columns: ["close_price"],
    begin: Date.UTC(2026, 5, 17, 7),
    end: Date.UTC(2026, 5, 17, 9),
    resolution: "1h",
  } as const;

  // 30000 one-minute buckets x 1 exchange x 1 product x 1 column -> 2 chunks
  const chunkedParams = {
    exchanges: ["binance-futures"],
    products: ["BTCUSDT"],
    columns: ["close_price"],
    begin: Date.UTC(2026, 0, 1),
    end: Date.UTC(2026, 0, 1) + 30_000 * 60_000,
    resolution: "1m",
  } as const;

  /** A Velo client whose fetch returns one distinct row per request and records URLs. */
  function chunkedVelo() {
    const urls: string[] = [];
    const fetchFn: typeof globalThis.fetch = async (input) => {
      urls.push(String(input));
      const step = urls.length;
      return new Response(
        `exchange,coin,product,time,close_price\nbinance-futures,BTC,BTCUSDT,${step},${step * 10}\n`,
        { status: 200 },
      );
    };
    return { velo: new Velo({ apiKey: "test_key", fetch: fetchFn }), urls };
  }

  it("yields the same rows execute returns", async () => {
    const { velo: client } = velo(ROWS_CSV);
    const streamed = await collect(client.futures.query(params).stream());
    const executed = await client.futures.query(params).execute();

    expect(streamed).toEqual(executed);
    expect(streamed).toHaveLength(2);
  });

  it("is lazy: nothing is sent until the first next()", async () => {
    const { velo: client, urls } = velo(ROWS_CSV);
    const stream = client.futures.query(params).stream();
    expect(urls).toHaveLength(0); // creating the generator is not a request

    await stream.next();
    expect(urls).toHaveLength(1);
  });

  it("prefetches the next chunk while the current one is consumed, in time order", async () => {
    const { velo: client, urls } = chunkedVelo();
    const stream = client.futures.query(chunkedParams).stream();

    const first = await stream.next();
    expect(first.value?.close_price).toBe(10);
    expect(urls).toHaveLength(2); // chunk 2 already requested before chunk 1 is drained

    const rest = await collect(stream);
    expect(rest.map((row) => row.close_price)).toEqual([20]);
  });

  it("aborts the in-flight prefetch when the consumer breaks early", async () => {
    const urls: string[] = [];
    const signals: AbortSignal[] = [];
    const fetchFn: typeof globalThis.fetch = async (input, init) => {
      urls.push(String(input));
      const signal = init?.signal as AbortSignal;
      signals.push(signal);
      if (urls.length === 1) {
        return new Response(
          "exchange,coin,product,time,close_price\nbinance-futures,BTC,BTCUSDT,1,10\n",
          {
            status: 200,
          },
        );
      }
      // chunk 2 hangs until aborted
      return new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    };
    const client = new Velo({ apiKey: "test_key", fetch: fetchFn });

    for await (const row of client.futures.query(chunkedParams).stream()) {
      expect(row.close_price).toBe(10);
      break; // chunk 2 is in flight now
    }

    expect(urls).toHaveLength(2);
    expect(signals[1]?.aborted).toBe(true);
    // the swallowed prefetch rejection must not surface as an unhandled rejection,
    // which vitest would turn into a test failure
  });

  it("absorbs a prefetch failure while the consumer is paused, then rejects at next()", async () => {
    const urls: string[] = [];
    const fetchFn: typeof globalThis.fetch = async (input) => {
      urls.push(String(input));
      if (urls.length === 1) {
        return new Response(
          "exchange,coin,product,time,close_price\nbinance-futures,BTC,BTCUSDT,1,10\n",
          { status: 200 },
        );
      }
      return new Response("bad request", { status: 400 }); // chunk 2 fails fast
    };
    const client = new Velo({ apiKey: "test_key", fetch: fetchFn });

    const stream = client.futures.query(chunkedParams).stream();
    await stream.next(); // chunk 1 delivered; chunk 2 prefetch in flight

    // The 400 lands while the generator is suspended with nothing awaiting
    // it; an unhandled rejection here would fail the test run.
    await new Promise((resolve) => setTimeout(resolve, 20));

    await expect(stream.next()).rejects.toThrow(VeloError);
  });

  it("rejects mid-stream when a later chunk fails, after yielding earlier rows", async () => {
    const urls: string[] = [];
    const fetchFn: typeof globalThis.fetch = async (input) => {
      urls.push(String(input));
      if (urls.length === 1) {
        return new Response(
          "exchange,coin,product,time,close_price\nbinance-futures,BTC,BTCUSDT,1,10\n",
          {
            status: 200,
          },
        );
      }
      return new Response("bad request", { status: 400 });
    };
    const client = new Velo({ apiKey: "test_key", fetch: fetchFn });

    const seen: number[] = [];
    await expect(async () => {
      for await (const row of client.futures.query(chunkedParams).stream()) {
        seen.push(row.close_price as number);
      }
    }).rejects.toThrow(VeloError);
    expect(seen).toEqual([10]); // chunk 1 rows were delivered before the failure
  });

  it("completes with no rows on an empty body", async () => {
    const { velo: client } = velo("");
    expect(await collect(client.futures.query(params).stream())).toEqual([]);
  });
});

describe("Velo.caps", () => {
  it("queries /api/v1/caps with the coins", async () => {
    const body =
      "coin,time,circ,circ_dollars,fdv,fdv_dollars\nBTC,1783513513252,20053612,1248112746545.6,20053612,1248112746545.6\n";
    const { velo: client, urls } = velo(body);
    const rows = await client.caps(["BTC", "SOL"]);

    expect(new URL(urls[0] as string).pathname).toBe("/api/v1/caps");
    expect(searchParams(urls[0] as string).get("coins")).toBe("BTC,SOL");
    expect(rows[0]).toMatchObject({ coin: "BTC", circ: 20053612 });
    // fields are typed, no casts needed
    const circDollars: number | null = rows[0]!.circ_dollars;
    expect(circDollars).toBe(1248112746545.6);
  });

  it("rejects an empty coins list", async () => {
    const { velo: client } = velo("");
    await expect(client.caps([])).rejects.toThrow(VeloError);
  });

  it("rejects a response with an unexpected header", async () => {
    const { velo: client } = velo("coin,time,circ\nBTC,1783513513252,20053612\n");
    await expect(client.caps(["BTC"])).rejects.toThrow(/unexpected \/api\/v1\/caps/);
  });
});

describe("Velo.options.terms", () => {
  it("queries /api/v1/terms with the coins", async () => {
    const body = "coin,time,at_the_money_iv,dte,fwd_iv\nBTC,1767225600000,0.5,7,0.52\n";
    const { velo: client, urls } = velo(body);
    const rows = await client.options.terms(["BTC"]);

    expect(new URL(urls[0] as string).pathname).toBe("/api/v1/terms");
    expect(searchParams(urls[0] as string).get("coins")).toBe("BTC");
    expect(rows[0]).toMatchObject({ coin: "BTC", at_the_money_iv: 0.5 });
    // fields are typed, no casts needed
    const fwdIv: number | null = rows[0]!.fwd_iv;
    expect(fwdIv).toBe(0.52);
  });

  it("rejects a response with an unexpected header", async () => {
    const { velo: client } = velo("coin,time,at_the_money_iv\nBTC,1767225600000,0.5\n");
    await expect(client.options.terms(["BTC"])).rejects.toThrow(/unexpected \/api\/v1\/terms/);
  });

  it("rejects coins other than BTC and ETH", async () => {
    const { velo: client } = velo("");
    await expect(client.options.terms(["SOL" as never])).rejects.toThrow(/BTC, ETH/);
    await expect(client.options.terms([])).rejects.toThrow(VeloError);
  });
});
