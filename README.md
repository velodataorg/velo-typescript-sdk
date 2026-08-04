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
import { Velo } from "./index.js";

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
      .trades(["total"])
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

`velo.query()` resolves to a `Data` object with lazily computed views over the
fetched rows. Building a request sends nothing; `velo.query()` executes it, and
`velo.stream()` runs the same request yielding rows one at a time instead.

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

Results whose requested columns are the four OHLC prices plus at most one volume column are typed as `CandleData`, other results are typed as `Data`. Only `CandleData` exposes `candles()`, and buckets without trades are skipped. When accumulating rows from `stream()` instead, build the same views with `Data.from(rows)`.

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
