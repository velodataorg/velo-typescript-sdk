<div align="center">
  <h1>Velo TypeScript SDK</h1>
</div>
<p align="center">
  TypeScript SDK for Velo API
</p>
<br />

This repository contains the TypeScript SDK for the Velo API. It exposes a fluent builder for fetching market data.

## Quick start

### Usage

```ts
import { Velo } from "velo-sdk";

async function main() {
  const apiKey = process.env.VELO_API_KEY;
  if (!apiKey) throw new Error("VELO_API_KEY not set");

  const velo = new Velo({ apiKey });
  const data = await velo.query(
    velo.futures
      .price(["close", "high"]) // Using `price()` with no arguments selects all OHLC
      .openInterest(["close"], { metric: "dollar" }) // Choose `dollar` or `coin`
      .volume(["total"])
      .premium()
      .for({
        exchanges: ["binance-futures", "bybit"],
        coins: ["BTC"], // `coins` accepts the Velo-aggregated symbols
      })
      .over({
        last: "11m",
        resolution: "1m",
      }),
  );

  for (const row of data.rows()) {
    console.log(row);
  }
}

main();
```

The `exchanges` cross-joins with `products` (or `coins`) for the amount of data returned. If the result is not `.rows()`, then the result contains one series per (exchange, product) pair, keyed `"exchange:product"`.

```
exchanges: ["binance-futures", "bybit"]     products: ["BTCUSDT", "ETHUSDT"]

            binance-futures:BTCUSDT   ─┐
            binance-futures:ETHUSDT    ├─ 2 × 2 = 4 series,
            bybit:BTCUSDT              │  one per (exchange, product) pair
            bybit:ETHUSDT             ─┘
```

### Fetch list of available products

Fetch and locally search the products catalog.

```ts
const futures = await velo.query(velo.catalog.futures({ product: "BTCUSDT" }));
const spot = await velo.query(velo.catalog.spot({ coin: "BTC" }));
const options = await velo.query(velo.catalog.options({ coin: "BTC" }));
```

### Result views

For market-row requests, `velo.query()` resolves to a `Data` object with lazily computed views over the fetched rows. Building a request sends nothing, `velo.query()` executes it, and `velo.stream()` runs the same request yielding rows one at a time.

```ts
const data = await velo.query(
  velo.futures
    .price()
    .volume(["total"])
    .for({
      exchanges: ["binance-futures"],
      coins: ["BTC"],
    })
    .over({
      last: "1h",
      resolution: "1m",
    }),
);

// Different ways to view the returned data
const rows = data.rows();
const series = data.series();
const columns = data.columns();
const candles = data.candles();
```

Results containing exactly the four OHLC price columns, optionally with one total-volume column (`coin_volume` or `dollar_volume`), are typed as `CandleData` and expose the `candles()` method.

### News

Fetch historical stories published after a millisecond timestamp. Omit `begin` to use the API default and request the full history from timestamp `0`.

```ts
const stories = await velo.query(
  velo.news.stories({
    begin: Date.now() - 24 * 60 * 60 * 1000,
  }),
);

for (const story of stories) {
  console.log(story);
}
```

It is possible to watch new, edited, and deleted stories in real time:

```ts
const watcher = await velo.watch(velo.news.feed(), {
  on: {
    story: (story) => console.log("new", story),
    edit: (story) => console.log("edit", story),
    delete: ({ id }) => console.log("delete", id),
    error: (error) => console.error(error),
    close: ({ code, reason }) => console.log("closed", code, reason),
  },
});
```

`velo.watch()` starts connecting immediately and resolves once the first connection is live. Connection failures and unexpected later drops retry automatically by default.

`velo.watch()` also accepts connection and retry options:

```ts
const controller = new AbortController();
const watcher = await velo.watch(velo.news.feed(), {
  signal: controller.signal, // Closes the watcher when aborted
  connectTimeout: 30_000, // Limit each connection attempt (default 30s)
  heartbeatTimeout: 300_000, // Fail when the feed goes silent (default 5m)
  reconnect: { retries: 5, baseDelayMs: 500, maxDelayMs: 30_000 },
  onListenerError: (error) => console.error(error), // Receives errors your listeners throw
});
```

Pass `reconnect: false` for one initial connection attempt and no automatic recovery. The resolved watcher can be paused with `disconnect()`, manually reopened with `connect()`, or permanently disposed with `close()`.

### Channels

Watch live market data by building channels with `channel` and passing them to `velo.channels.feed()`. A product follows one exchange, and a coin, such as `{ coin: "BTC" }`, is aggregated across exchanges.

```ts
import { Velo, channel } from "velo-sdk";

const watcher = await velo.watch(
  velo.channels.feed([
    channel.price({ exchange: "binance-futures", coin: "BTC", product: "BTCUSDT" }),
    channel.openInterest({ coin: "BTC" }, { metric: "coins" }), // Aggregated open interest when `coin` is passed
  ]),
  {
    on: {
      data: (event) => {
        // Checking `kind` narrows `data` to that channel's rows
        if (event.kind === "price") console.log(event.data.time, event.data.close_price);
        else console.table(event.data);
      },
      decodeError: ({ channel, error }) => console.error("skipped a frame of", channel, error),
      channelError: ({ channel, reason }) => console.error(channel, "stopped:", reason),
      error: (error) => console.error(error),
      close: ({ code, reason }) => console.log("closed", code, reason),
    },
  },
);
```
