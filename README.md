<div align="center">
  <h1>Velo TypeScript SDK</h1>
</div>
<p align="center">
  A TypeScript SDK for Velo API
</p>
<br />

This repository contains the TypeScript SDK for the Velo API. It exposes typed queries for fetching market data.

## Usage

```ts
import { Velo } from "../src/index.js";

async function main() {
  const apiKey = process.env.VELO_API_KEY;
  if (!apiKey) throw new Error("VELO_API_KEY not set");

  const velo = new Velo({ apiKey });
  const rows = await velo.futures
    .query({
      exchanges: ["binance-futures", "bybit"],
      products: ["BTCUSDT"],
      columns: ["close_price", "funding_rate"],
      begin: Date.now() - 10 * 60 * 1000,
      end: Date.now(),
      resolution: "1m",
    })
    .execute();

  for (const row of rows) {
    console.log(row);
  }
}

main();
```

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
