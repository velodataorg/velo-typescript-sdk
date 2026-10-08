export const BASE_URL = "https://api.velo.xyz";

export const STATUS_PATH = "/api/v1/status";
export const ROWS_PATH = "/api/v1/rows";
export const FUTURES_CATALOG_PATH = "/api/v1/futures";
export const OPTIONS_CATALOG_PATH = "/api/v1/options";
export const SPOT_CATALOG_PATH = "/api/v1/spot";
export const TERMS_PATH = "/api/v1/terms";
export const CAPS_PATH = "/api/v1/caps";
export const NEWS_PATH = "/api/n/news";
/* The one socket endpoint: the news feed and every realtime channel connect here. */
export const WEBSOCKET_PATH = "/api/w/connect";
/* The same path, under the name 0.1 published it as. */
export const NEWS_WEBSOCKET_PATH = WEBSOCKET_PATH;
export const ORDERBOOK_PATH = "/api/v1/heatmap";
