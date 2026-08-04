import {
  FUTURES_CATALOG_PATH,
  OPTIONS_CATALOG_PATH,
  SPOT_CATALOG_PATH,
} from "../../../constants/endpoints.ts";
import type { QueryPlan } from "../../common/query.ts";
import {
  decodeFuturesCatalog,
  type FutureProduct,
  type FuturesCatalogParams,
  prepareFuturesCatalogParams,
  decodeFuturesCatalogLines,
} from "./futures.ts";
import {
  decodeOptionsCatalog,
  type OptionProduct,
  type OptionsCatalogParams,
  prepareOptionsCatalogParams,
  decodeOptionsCatalogLines,
} from "./options.ts";
import { CatalogParams } from "./params.ts";
import {
  decodeSpotCatalog,
  prepareSpotCatalogParams,
  type SpotCatalogParams,
  type SpotProduct,
  decodeSpotCatalogLines,
} from "./spot.ts";

/** Plans a futures product-catalog query. */
export function planFuturesCatalog(params: FuturesCatalogParams): QueryPlan<FutureProduct> {
  const prepared = prepareFuturesCatalogParams(params);
  return {
    requests: [
      {
        path: FUTURES_CATALOG_PATH,
        params: { delisted: prepared.delisted ? 1 : 0 },
      },
    ],
    decode: (body) => CatalogParams.filter(decodeFuturesCatalog(body, prepared.delisted), prepared),
    async *decodeLines(lines) {
      for await (const row of decodeFuturesCatalogLines(lines, prepared.delisted)) {
        if (CatalogParams.matches(row, prepared)) yield row;
      }
    },
  };
}

/** Plans an options product-catalog query. */
export function planOptionsCatalog(params: OptionsCatalogParams): QueryPlan<OptionProduct> {
  const prepared = prepareOptionsCatalogParams(params);
  return {
    requests: [{ path: OPTIONS_CATALOG_PATH, params: { delisted: 0 } }],
    decode: (body) => CatalogParams.filter(decodeOptionsCatalog(body), prepared),
    async *decodeLines(lines) {
      for await (const row of decodeOptionsCatalogLines(lines)) {
        if (CatalogParams.matches(row, prepared)) yield row;
      }
    },
  };
}

/** Plans a spot product-catalog query. */
export function planSpotCatalog(params: SpotCatalogParams): QueryPlan<SpotProduct> {
  const prepared = prepareSpotCatalogParams(params);
  return {
    requests: [
      {
        path: SPOT_CATALOG_PATH,
        params: { delisted: prepared.delisted ? 1 : 0 },
      },
    ],
    decode: (body) => CatalogParams.filter(decodeSpotCatalog(body, prepared.delisted), prepared),
    async *decodeLines(lines) {
      for await (const row of decodeSpotCatalogLines(lines, prepared.delisted)) {
        if (CatalogParams.matches(row, prepared)) yield row;
      }
    },
  };
}
