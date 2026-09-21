export const BASE_URL = "https://api.velo.xyz";

export const STATUS_PATH = "/api/v1/status";
export const ROWS_PATH = "/api/v1/rows";
export const FUTURES_CATALOG_PATH = "/api/v1/futures";
export const OPTIONS_CATALOG_PATH = "/api/v1/options";
export const SPOT_CATALOG_PATH = "/api/v1/spot";
export const TERMS_PATH = "/api/v1/terms";
export const CAPS_PATH = "/api/v1/caps";
export const NEWS_PATH = "/api/n/news";
export const REALTIME_WEBSOCKET_PATH = "/api/w/connect";
/* The news feed is one channel of the realtime socket, subscribed with the v1 verb. */
export const NEWS_WEBSOCKET_PATH = REALTIME_WEBSOCKET_PATH;
export const ONDEMAND_WEBSOCKET_PATH = "/api/o/connect";
export const ORDERBOOK_PATH = "/api/v1/heatmap";
