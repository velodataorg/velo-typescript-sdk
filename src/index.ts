export type { MarketCaps } from "./client/api/market-caps/market-caps.ts";
export type { MarketCapsHistoryBuilder } from "./client/api/market-caps/builder.ts";
export type { MarketCapsParams } from "./client/api/market-caps/params.ts";
export type { MarketCap } from "./client/api/market-caps/validation.ts";
export { MARKET_CAPS_COLUMNS } from "./client/api/market-caps/validation.ts";
export type { Catalog } from "./client/api/catalog/catalog.ts";
export type {
  FuturesCatalogBuilder,
  OptionsCatalogBuilder,
  SpotCatalogBuilder,
} from "./client/api/catalog/builder.ts";
export type { FutureProduct, FuturesCatalogParams } from "./client/api/catalog/futures.ts";
export type { OptionProduct, OptionsCatalogParams } from "./client/api/catalog/options.ts";
export type { CatalogParams } from "./client/api/catalog/params.ts";
export type { SpotCatalogParams, SpotProduct } from "./client/api/catalog/spot.ts";
export type { VeloConfig } from "./client/client.ts";
export { Velo } from "./client/client.ts";
export {
  catalog,
  channels,
  futures,
  marketCaps,
  news,
  options,
  orderbook,
  spot,
} from "./client/builders.ts";
export type { Channels, ChannelsParams } from "./client/api/channels/channels.ts";
export { channel } from "./channel/channel.ts";
export type {
  ChannelDescriptor,
  ChannelEnvelope,
  ChannelInput,
  ChannelMessage,
  DescriptorOf,
  RawChannel,
  RawChannelMessage,
} from "./channel/channel.ts";
export type { ChannelError } from "./client/api/channels/decode.ts";
export type {
  ChannelsWatcher,
  ChannelsWatcherEvents,
  ChannelsWatchOptions,
} from "./client/api/channels/watcher.ts";
export { DEFAULT_CHANNELS_CONNECT_TIMEOUT } from "./client/api/channels/watcher.ts";
export type {
  QueryBuilder,
  QueryInput,
  QueryItem,
  QueryKind,
  QueryRequest,
  QueryResult,
  StreamableKind,
} from "./client/query/plan.ts";
export { DEFAULT_WATCH_RECONNECT } from "./client/watch/connection.ts";
export type { ResumeOptions } from "./client/watch/connection.ts";
export type { EventListeners, TaggedEvent, WatcherOf, WatchState } from "./client/watch/watcher.ts";
export type {
  WatchableKind,
  WatchBuilder,
  Watcher,
  WatchEvent,
  WatchEventListener,
  WatchEventListeners,
  WatchInput,
  WatchListeners,
  WatchOptions,
  WatchParams,
  WatchRequest,
} from "./client/watch/registry.ts";
export type { FuturesBasisBuilder, FuturesBasisScope } from "./client/api/futures/basis.ts";
export type { FuturesBuilder } from "./client/api/futures/builder.ts";
export type {
  FuturesFundingRatePart,
  FuturesLiquidationPart,
  FuturesLiquidationVolumeMetric,
  FuturesLiquidationVolumePart,
  FuturesOpenInterestMetric,
  FuturesOpenInterestPart,
  FuturesMarketScope,
  FuturesPricePart,
  FuturesTradePart,
  FuturesVolumeMetric,
  FuturesVolumePart,
  LastDuration,
  MarketScope,
  MarketRowsScope,
  RowsScope,
  TargetScope,
  TimeScope,
  WindowScope,
} from "./client/api/futures/builder.ts";
export type { Futures } from "./client/api/futures/futures.ts";
export type {
  BasisCoin,
  FuturesBasisParams,
  FuturesParams,
  FuturesRow,
  FuturesStandardParams,
} from "./client/api/futures/params.ts";
export { BASIS_COINS } from "./client/api/futures/params.ts";
export type { News } from "./client/api/news/news.ts";
export type { NewsFeedBuilder, NewsStoriesBuilder } from "./client/api/news/builder.ts";
export type { NewsStoriesParams } from "./client/api/news/params.ts";
export type { NewsStory } from "./client/api/news/validation.ts";
export type {
  NewsClose,
  NewsDelete,
  NewsWatcher,
  NewsWatcherEvents,
  NewsWatcherListener,
  NewsWatcherState,
  NewsWatchOptions,
} from "./client/api/news/watcher.ts";
export {
  DEFAULT_NEWS_CONNECT_TIMEOUT,
  DEFAULT_NEWS_HEARTBEAT_TIMEOUT,
} from "./client/api/news/watcher.ts";
export type { Options } from "./client/api/options/options.ts";
export type {
  OptionsBuilder,
  OptionsDeltaMetric,
  OptionsDeltaPart,
  OptionsDvolPart,
  OptionsGammaMetric,
  OptionsIvTenor,
  OptionsMarketScope,
  OptionsNotionalPart,
  OptionsPremiumPart,
  OptionsSkewTenor,
  OptionsVegaMetric,
  OptionsVolumePart,
} from "./client/api/options/builder.ts";
export type { OptionsParams, OptionsRow } from "./client/api/options/params.ts";
export type {
  OptionsTermsBuilder,
  TermPoint,
  TermsCoin,
  TermsParams,
} from "./client/api/options/terms.ts";
export { TERMS_COINS, TERMS_COLUMNS } from "./client/api/options/terms.ts";
export type { Orderbook } from "./client/api/orderbook/orderbook.ts";
export type { OrderbookLevelsBuilder } from "./client/api/orderbook/builder.ts";
export { OrderbookData } from "./client/api/orderbook/data.ts";
export type {
  OrderbookLevel,
  OrderbookRow,
  OrderbookSnapshot,
} from "./client/api/orderbook/data.ts";
export type {
  OrderbookParams,
  OrderbookParamsCoin,
  OrderbookParamsProduct,
  OrderbookResolution,
} from "./client/api/orderbook/params.ts";
export type { OrderbookScope, OrderbookTarget } from "./client/api/orderbook/scope.ts";
export type { SpotParams, SpotRow } from "./client/api/spot/params.ts";
export type {
  SpotBuilder,
  SpotMarketScope,
  SpotPricePart,
  SpotTradePart,
  SpotVolumeMetric,
  SpotVolumePart,
} from "./client/api/spot/builder.ts";
export type { Spot } from "./client/api/spot/spot.ts";
export type { Status, StatusResponse } from "./client/api/status/status.ts";
export {
  BASE_URL,
  CAPS_PATH,
  CHANNELS_WEBSOCKET_PATH,
  FUTURES_CATALOG_PATH,
  NEWS_PATH,
  NEWS_WEBSOCKET_PATH,
  ONDEMAND_WEBSOCKET_PATH,
  OPTIONS_CATALOG_PATH,
  ORDERBOOK_PATH,
  ROWS_PATH,
  SPOT_CATALOG_PATH,
  STATUS_PATH,
  TERMS_PATH,
} from "./constants/endpoints.ts";
export type {
  FuturesColumn,
  FuturesStandardColumn,
  OptionsColumn,
  SpotColumn,
} from "./client/market/columns.ts";
export {
  BASIS_COLUMN,
  FUTURES_COLUMNS,
  OPTIONS_COLUMNS,
  SPOT_COLUMNS,
} from "./client/market/columns.ts";
export { Data } from "./client/data/data.ts";
export type { CandleData, DataResult, SeriesColumns } from "./client/data/data.ts";
export type {
  Exchange,
  FuturesExchange,
  OptionsExchange,
  SpotExchange,
} from "./client/market/exchanges.ts";
export { FUTURES_EXCHANGES, OPTIONS_EXCHANGES, SPOT_EXCHANGES } from "./client/market/exchanges.ts";
export type { MarketType } from "./client/rows/params.ts";
export type { CanCandle, Candle, OhlcColumn } from "./client/data/candles.ts";
export type { ProductKey } from "./client/data/product-key.ts";
export { formatProductKey, parseProductKey } from "./client/data/product-key.ts";
export type { Resolution, ResolutionValue } from "./client/time/resolution.ts";
export { RESOLUTIONS, toResolutionValue } from "./client/time/resolution.ts";
export type { Row, RowBase, RowColumns } from "./client/data/row.ts";
export { MAX_REQUESTS_PER_QUERY } from "./client/query/query.ts";
export {
  VeloAuthError,
  VeloBadRequestError,
  VeloConnectionError,
  VeloError,
  VeloHttpError,
  VeloRateLimitError,
  VeloRequestError,
  VeloServerError,
  VeloTimeoutError,
} from "./errors.ts";
export { DEFAULT_TIMEOUT } from "./transport/http.ts";
export type { HttpParams, HttpRequestOptions } from "./transport/http.ts";
export { DEFAULT_RATE_LIMIT } from "./transport/rate-limit.ts";
export type { RateLimitOptions } from "./transport/rate-limit.ts";
export { DEFAULT_RETRY } from "./transport/retry.ts";
export type { RetryOptions } from "./transport/retry.ts";
export type {
  WebSocketCloseEvent,
  WebSocketConnection,
  WebSocketErrorEvent,
  WebSocketEvents,
  WebSocketFactory,
  WebSocketMessageEvent,
  WebSocketTarget,
} from "./transport/websocket.ts";
