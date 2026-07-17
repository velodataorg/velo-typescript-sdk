<div align="center">
  <h1>Velo TypeScript SDK</h1>
</div>
<p align="center">
  A TypeScript SDK for Velo API
</p>
<br />

This repository contains the TypeScript SDK for the Velo API. The SDK exposes a fluent builder and a query builder patttern for sending requests, simplifying the process of fetching market data.

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

## News

Fetch historical stories published after a millisecond timestamp:

```ts
import { Velo } from "../src/index.js";

const apiKey = process.env.VELO_API_KEY;
if (!apiKey) throw new Error("VELO_API_KEY not set");

const velo = new Velo({ apiKey });
const stories = await velo.news.stories({
  // Fetch stories from the last 24h
  begin: Date.now() - 24 * 60 * 60 * 1000,
});

for (const story of stories) {
  console.log(story);
}
```

Omit `begin` to use the API default and request the full history from timestamp `0`.

Watch new, edited, and deleted stories in real time:

```ts
import { Velo } from "../src/index.js";

async function main() {
  const apiKey = process.env.VELO_API_KEY;
  if (!apiKey) throw new Error("VELO_API_KEY not set");

  const velo = new Velo({ apiKey });
  const watcher = velo.news.watch()
    .on("story", (story) => console.log("new", story))
    .on("edit", (story) => console.log("edit", story))
    .on("delete", ({ id }) => console.log("delete", id))
    .on("error", (error) => console.error(error))
    .on("close", ({ code, reason }) => console.log("closed", code, reason));
  await watcher.connect();
}

main();
```
