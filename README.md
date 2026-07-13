# @velodata/sdk

TypeScript SDK for the [Velo API](https://velo.xyz) — crypto futures, options, and spot market data, plus curated news.

> **Status: work in progress.** Not yet published.

- Two tiny runtime dependencies (d3-dsv, query-string), ESM-only, Node ≥ 22 (works on Bun, Deno, and edge runtimes)
- Fully typed query builder: the row type is inferred from the columns you request
- Automatic request batching (22.5k-value limit) and rate-limit-aware retries
- News over HTTP and streaming WebSocket

```ts
import { Velo } from "@velodata/sdk";

const velo = new Velo({ apiKey: process.env.VELO_API_KEY });

const rows = await velo
  .futures()
  .exchanges("binance-futures")
  .products("BTCUSDT")
  .columns("open_price", "high_price", "low_price", "close_price")
  .last("24h")
  .resolution("1h")
  .collect();
```

## Development

```bash
bun install
bun run test        # runtime + type-level tests
bun run build       # tsdown → dist/
bun run lint        # oxlint
```
