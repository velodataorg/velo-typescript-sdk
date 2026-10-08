import { Catalog } from "./api/catalog/catalog.ts";
import { Channels } from "./api/channels/channels.ts";
import { Futures } from "./api/futures/futures.ts";
import { MarketCaps } from "./api/market-caps/market-caps.ts";
import { News } from "./api/news/news.ts";
import { Options } from "./api/options/options.ts";
import { Orderbook } from "./api/orderbook/orderbook.ts";
import { Spot } from "./api/spot/spot.ts";

/**
 * The request-describing namespaces, usable without a client.
 *
 * Describing a request needs no transport and no credentials, so these are
 * shared values rather than per-client instances: they only ever hand back
 * new immutable builders. A `Velo` exposes these same objects, so a request
 * built here is the request the client executes.
 *
 * Executing is the client's job — pass what these produce to `velo.query()`,
 * `velo.stream()`, or `velo.watch()`.
 */
export const futures = new Futures();
export const options = new Options();
export const spot = new Spot();
export const orderbook = new Orderbook();
export const catalog = new Catalog();
export const news = new News();
export const channels = new Channels();
export const marketCaps = new MarketCaps();
