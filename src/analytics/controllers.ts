import type { Core } from '@strapi/strapi';
import {
  parseFilters,
  parseSort,
  parseLimitOffset,
  parsePagination,
  parseCompareFilters,
  InvalidFilterError,
  type AnalyticsFilters,
} from './filters';
import * as queries from './queries';
import * as catalogQueries from './catalog-queries';
import { parseCatalogFilters, InvalidCatalogFilterError } from './catalog-queries';

type Handler = (ctx: any) => Promise<void>;

const safeHandler = (strapi: Core.Strapi, fn: (ctx: any) => Promise<void>): Handler => {
  return async (ctx) => {
    try {
      await fn(ctx);
    } catch (error) {
      if (error instanceof InvalidFilterError || error instanceof InvalidCatalogFilterError) {
        return ctx.badRequest(error.message);
      }
      strapi.log.error('[analytics] Ошибка при построении отчёта:', error);
      throw error;
    }
  };
};

const wrap = (
  fn: (strapi: Core.Strapi, filters: AnalyticsFilters) => Promise<unknown>
): ((strapi: Core.Strapi) => Handler) => {
  return (strapi: Core.Strapi) =>
    safeHandler(strapi, async (ctx) => {
      const filters = parseFilters(ctx.query ?? {});
      ctx.body = { data: await fn(strapi, filters) };
    });
};

/** Валидирует :id из пути как положительное целое (numeric id пользователя, не documentId). */
function parseUserIdParam(ctx: any): number {
  const raw = ctx.params?.id;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new InvalidFilterError(`Некорректный id пользователя: "${raw}"`);
  }
  return id;
}

export const createControllers = (strapi: Core.Strapi) => ({
  overview: wrap(queries.getOverview)(strapi),
  receiptsDaily: wrap(queries.getReceiptsDaily)(strapi),
  cashbackDaily: wrap(queries.getCashbackDaily)(strapi),
  statuses: wrap(queries.getStatuses)(strapi),
  weekday: wrap(queries.getWeekday)(strapi),
  hourly: wrap(queries.getHourly)(strapi),

  cities: safeHandler(strapi, async (ctx) => {
    const filters = parseFilters(ctx.query ?? {});
    const sort = parseSort(ctx.query ?? {}, queries.CITIES_SORT_FIELDS, 'receiptsCount');
    ctx.body = { data: await queries.getCities(strapi, filters, sort) };
  }),

  users: safeHandler(strapi, async (ctx) => {
    const filters = parseFilters(ctx.query ?? {});
    const sort = parseSort(ctx.query ?? {}, queries.USERS_SORT_FIELDS, 'totalAmount');
    const { limit, offset } = parseLimitOffset(ctx.query ?? {});
    const { rows, total } = await queries.getUsersList(strapi, filters, sort, { limit, offset });
    ctx.body = {
      data: rows,
      pagination: { page: Math.floor(offset / limit) + 1, pageSize: limit, total },
    };
  }),

  userDetail: safeHandler(strapi, async (ctx) => {
    const userId = parseUserIdParam(ctx);
    const info = await queries.getUserInfo(strapi, userId);
    if (!info) return ctx.notFound('Пользователь не найден');

    const filters = { ...parseFilters(ctx.query ?? {}), userId };
    const [metrics, statuses] = await Promise.all([
      queries.getUserMetrics(strapi, filters),
      queries.getUserStatuses(strapi, filters),
    ]);

    ctx.body = { data: { ...info, ...metrics, statuses } };
  }),

  userDaily: safeHandler(strapi, async (ctx) => {
    const userId = parseUserIdParam(ctx);
    const info = await queries.getUserInfo(strapi, userId);
    if (!info) return ctx.notFound('Пользователь не найден');

    const filters = { ...parseFilters(ctx.query ?? {}), userId };
    ctx.body = { data: await queries.getUserDaily(strapi, filters) };
  }),

  userCities: safeHandler(strapi, async (ctx) => {
    const userId = parseUserIdParam(ctx);
    const info = await queries.getUserInfo(strapi, userId);
    if (!info) return ctx.notFound('Пользователь не найден');

    const filters = { ...parseFilters(ctx.query ?? {}), userId };
    ctx.body = { data: await queries.getUserCities(strapi, filters) };
  }),

  userReceipts: safeHandler(strapi, async (ctx) => {
    const userId = parseUserIdParam(ctx);
    const info = await queries.getUserInfo(strapi, userId);
    if (!info) return ctx.notFound('Пользователь не найден');

    const filters = { ...parseFilters(ctx.query ?? {}), userId };
    const sort = parseSort(ctx.query ?? {}, queries.USER_RECEIPTS_SORT_FIELDS, 'date');
    const pagination = parsePagination(ctx.query ?? {});
    const { rows, total } = await queries.getUserReceipts(strapi, filters, sort, pagination);
    ctx.body = {
      data: rows,
      pagination: { page: pagination.page, pageSize: pagination.pageSize, total },
    };
  }),

  products: safeHandler(strapi, async (ctx) => {
    const filters = parseFilters(ctx.query ?? {});
    const catalogFilters = parseCatalogFilters(ctx.query ?? {});
    const sort = parseSort(ctx.query ?? {}, catalogQueries.PRODUCTS_SORT_FIELDS, 'totalAmount');
    const { limit, offset } = parseLimitOffset(ctx.query ?? {});
    const { rows, total } = await catalogQueries.getProducts(strapi, filters, catalogFilters, sort, {
      limit,
      offset,
    });
    ctx.body = {
      data: rows,
      pagination: { page: Math.floor(offset / limit) + 1, pageSize: limit, total },
    };
  }),

  groups: safeHandler(strapi, async (ctx) => {
    const filters = parseFilters(ctx.query ?? {});
    const catalogFilters = parseCatalogFilters(ctx.query ?? {});
    const sort = parseSort(ctx.query ?? {}, catalogQueries.GROUPS_SORT_FIELDS, 'totalAmount');
    ctx.body = { data: await catalogQueries.getGroups(strapi, filters, catalogFilters, sort) };
  }),

  categories: safeHandler(strapi, async (ctx) => {
    const filters = parseFilters(ctx.query ?? {});
    const catalogFilters = parseCatalogFilters(ctx.query ?? {});
    const sort = parseSort(ctx.query ?? {}, catalogQueries.CATEGORIES_SORT_FIELDS, 'totalAmount');
    const { limit, offset } = parseLimitOffset(ctx.query ?? {});
    const { rows, total } = await catalogQueries.getCategories(strapi, filters, catalogFilters, sort, {
      limit,
      offset,
    });
    ctx.body = {
      data: rows,
      pagination: { page: Math.floor(offset / limit) + 1, pageSize: limit, total },
    };
  }),

  suppliers: safeHandler(strapi, async (ctx) => {
    const filters = parseFilters(ctx.query ?? {});
    const catalogFilters = parseCatalogFilters(ctx.query ?? {});
    const sort = parseSort(ctx.query ?? {}, catalogQueries.SUPPLIERS_SORT_FIELDS, 'totalAmount');
    ctx.body = { data: await catalogQueries.getSuppliers(strapi, filters, catalogFilters, sort) };
  }),

  ofd: safeHandler(strapi, async (ctx) => {
    const filters = parseFilters(ctx.query ?? {});
    ctx.body = { data: await queries.getOfd(strapi, filters) };
  }),

  compare: safeHandler(strapi, async (ctx) => {
    const { current, previous } = parseCompareFilters(ctx.query ?? {});
    ctx.body = { data: await queries.getCompare(strapi, current, previous) };
  }),

  platforms: safeHandler(strapi, async (ctx) => {
    const filters = parseFilters(ctx.query ?? {});
    const { data, note } = await queries.getPlatforms(strapi, filters);
    ctx.body = { data, note };
  }),

  demographics: safeHandler(strapi, async (ctx) => {
    const filters = parseFilters(ctx.query ?? {});
    ctx.body = { data: await queries.getDemographics(strapi, filters) };
  }),

  appVersions: safeHandler(strapi, async (ctx) => {
    const filters = parseFilters(ctx.query ?? {});
    ctx.body = { data: await queries.getAppVersions(strapi, filters) };
  }),

  appVersionsTrend: safeHandler(strapi, async (ctx) => {
    const filters = parseFilters(ctx.query ?? {});
    const granularityRaw = ctx.query?.granularity;
    if (granularityRaw != null && granularityRaw !== 'day' && granularityRaw !== 'week') {
      return ctx.badRequest(`Некорректный параметр granularity: "${granularityRaw}" (day|week)`);
    }
    const granularity = granularityRaw === 'week' ? 'week' : 'day';
    ctx.body = { data: await queries.getAppVersionsTrend(strapi, filters, granularity) };
  }),

  metaCities: safeHandler(strapi, async (ctx) => {
    ctx.body = { data: await queries.getCitiesList(strapi) };
  }),
});
