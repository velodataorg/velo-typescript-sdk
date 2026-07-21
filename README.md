<div align="center">
  <h1>Velo TypeScript SDK</h1>
</div>
<p align="center">
  A TypeScript SDK for Velo API
</p>
<br />

This repository contains the TypeScript SDK for the Velo API. It exposes typed queries for fetching market data.

## Usage

### Overview

```ts
import { Velo } from "../src/index.js";

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

### Result views

`execute()` resolves to a `Data` object: lazily computed views over the fetched rows.

```ts
const data = await velo.spot
  .query({
    exchanges: ["coinbase", "binance"],
    coins: ["BTC"],
    columns: ["open_price", "high_price", "low_price", "close_price", "dollar_volume"],
    begin: Date.now() - 60 * 60 * 1000,
    end: Date.now(),
    resolution: "1m",
  })
  .execute();

data.rows(); // flat rows, series interleaved by time
data.series(); // Map keyed "exchange:product" -> one series' rows
data.columns(); // per series: { time: Float64Array, values: { close_price: Float64Array, ... } }
data.candles(); // per series: { time, open, high, low, close, volume } per bucket
```

`candles()` is only available when the requested columns are the four OHLC prices plus at most one volume column; buckets without trades are skipped. When accumulating rows from `stream()` instead, build the same views with `Data.from(rows)`.

### Catalog

Fetch and locally search the active product catalogs:

```ts
const futures = await velo.catalog.futures({ coin: "BTC" });
const spot = await velo.catalog.spot({ coin: "BTC" });
const options = await velo.catalog.options({ coin: "BTC" });
```

### Options term structure

Fetch the current BTC and ETH options term structures:

```ts
const points = await velo.options.terms({ coins: ["BTC", "ETH"] }).execute();

for (const point of points) {
  console.log(point.time, point.at_the_money_iv, point.fwd_iv);
}
```

The term-structure endpoint supports BTC and ETH. Implied-volatility fields are `null` when the API
has no value for an expiry.

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
