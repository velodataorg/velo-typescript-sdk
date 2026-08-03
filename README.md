<div align="center">
  <h1>Velo TypeScript SDK</h1>
</div>
<p align="center">
  TypeScript SDK for Velo API
</p>
<br />

This repository contains the TypeScript SDK for the Velo API. It exposes a fluent builder and typed queries for fetching market data.

## Quick start

### Builder pattern

The builder pattern is syntactic sugar on top of the core SDK. Optional
selections chain; the required scope — a target (`products` or `coins`), a
time range (`between` or `last`), and a `resolution` — is passed to the
terminal method, so an incomplete query is a compile-time error.

```ts
import { Velo } from "./index.js";

async function main() {
  const apiKey = process.env.VELO_API_KEY;
  if (!apiKey) throw new Error("VELO_API_KEY not set");

  const velo = new Velo({ apiKey });
  const data = await velo.futures
    .price(["close", "high"]) // Using `price()` with no arguments selects all OHLC
    .openInterest(["close"], { metric: "dollar" }) // Choose the metric, e.g. `dollar` or `coin`
    .volume(["total"])
    .premium()
    .trades(["total"])
    .fetch({
      coins: ["BTC"], // `coins` accepts the Velo-aggregated symbols
      last: "11m",
      resolution: "1m",
    });

  for (const row of data.rows()) {
    console.log(row);
  }
}

main();
```

### Query pattern

The query pattern utilizes objects as params.

```ts
import { Velo } from "./index.js";

async function main() {
  const apiKey = process.env.VELO_API_KEY;
  if (!apiKey) throw new Error("VELO_API_KEY not set");

  const velo = new Velo({ apiKey });
  const data = await velo.futures
    .query({
      exchanges: ["binance-futures", "bybit"],
      products: ["BTCUSDT"],
      columns: ["close_price", "funding_rate"],
      begin: Date.now() - 10 * 60 * 1000,
      end: Date.now(),
      resolution: "1m",
    })
    .execute();

  for (const row of data.rows()) {
    console.log(row);
  }
}

main();
```

`exchanges` cross-joins with `products` (or `coins`): the result contains one
series per (exchange, product) pair, keyed `"exchange:product"`.

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
const futures = await velo.catalog.futures({ product: "BTCUSDT" });
const spot = await velo.catalog.spot({ coin: "BTC" });
const options = await velo.catalog.options({ coin: "BTC" });
```

### Result views

`fetch()` and a built query's `execute()` resolve to a `Data` object: lazily
computed views over the fetched rows.

```ts
const data = await velo.futures
  .query({
    exchanges: ["binance-futures"],
    coins: ["BTC"],
    columns: ["open_price", "high_price", "low_price", "close_price", "dollar_volume"],
    begin: Date.now() - 60 * 60 * 1000,
    end: Date.now(),
    resolution: "1m",
  })
  .execute();

// Different ways to view the returned data
const rows = data.rows();
const series = data.series();
const columns = data.columns();
const candles = data.candles();
```

`candles()` is only available when the requested columns are the four OHLC prices plus at most one volume column; buckets without trades are skipped. When accumulating rows from `stream()` instead, build the same views with `Data.from(rows)`.

### News

Fetch historical stories published after a millisecond timestamp.
Omit `begin` to use the API default and request the full history from timestamp `0`.

```ts
const stories = await velo.news.stories({
  begin: Date.now() - 24 * 60 * 60 * 1000,
});

for (const story of stories) {
  console.log(story);
}
```

It is possible to watch new, edited, and deleted stories in real time:

```ts
const watcher = velo.news
  .watch()
  .on("story", (story) => console.log("new", story))
  .on("edit", (story) => console.log("edit", story))
  .on("delete", ({ id }) => console.log("delete", id))
  .on("error", (error) => console.error(error))
  .on("close", ({ code, reason }) => console.log("closed", code, reason));

await watcher.connect();
```

`watch()` accepts a few options:

```ts
const watcher = velo.news.watch({
  signal: controller.signal, // Closes the watcher when aborted
  connectTimeout: 30_000, // Fail `connect()` if not subscribed in time (default 30s)
  heartbeatTimeout: 300_000, // Fail when the feed goes silent (default 5m)
  onListenerError: (error) => log.error(error), // Receives errors your listeners throw
});
```

The watcher never reconnects on its own: after an unexpected `close` event, call `connect()` again. Errors thrown by your event listeners never close the connection or crash the process — they go to `onListenerError` when provided, and otherwise to `reportError` in runtimes that have it or `console.error` elsewhere.
