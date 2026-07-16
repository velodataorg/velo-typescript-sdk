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
