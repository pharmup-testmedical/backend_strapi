import type { Knex } from 'knex';
import type { SqlClient } from './db';

export const VERIFICATION_STATUSES = [
  'auto_verified',
  'auto_rejected',
  'manual_review',
  'manually_verified',
  'manually_rejected',
  'auto_rejected_late_submission',
  'auto_partially_verified',
  'manually_partially_verified',
] as const;

export const OFD_TYPES = ['oofd', 'kofd', 'wofd'] as const;

export interface AnalyticsFilters {
  from?: string;
  to?: string;
  status?: (typeof VERIFICATION_STATUSES)[number];
  ofdType?: (typeof OFD_TYPES)[number];
  userId?: number;
  cityId?: number;
}

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;

export class InvalidFilterError extends Error {}

/**
 * Разбирает и валидирует общие query-параметры аналитики
 * (from/to/status/ofdType/userId/cityId). cityId фильтрует по
 * Receipt.organizationCity (город точки продажи), НЕ по User.city.
 */
export function parseFilters(query: Record<string, unknown>): AnalyticsFilters {
  const filters: AnalyticsFilters = {};

  if (query.from != null) {
    const from = String(query.from);
    if (!ISO_DATE_RE.test(from)) {
      throw new InvalidFilterError(`Некорректный параметр from: "${from}" (ожидается ISO-дата)`);
    }
    filters.from = from;
  }

  if (query.to != null) {
    const to = String(query.to);
    if (!ISO_DATE_RE.test(to)) {
      throw new InvalidFilterError(`Некорректный параметр to: "${to}" (ожидается ISO-дата)`);
    }
    filters.to = to;
  }

  if (query.status != null) {
    const status = String(query.status);
    if (!VERIFICATION_STATUSES.includes(status as any)) {
      throw new InvalidFilterError(`Некорректный параметр status: "${status}"`);
    }
    filters.status = status as AnalyticsFilters['status'];
  }

  if (query.ofdType != null) {
    const ofdType = String(query.ofdType);
    if (!OFD_TYPES.includes(ofdType as any)) {
      throw new InvalidFilterError(`Некорректный параметр ofdType: "${ofdType}"`);
    }
    filters.ofdType = ofdType as AnalyticsFilters['ofdType'];
  }

  if (query.userId != null) {
    const userId = Number(query.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new InvalidFilterError(`Некорректный параметр userId: "${query.userId}"`);
    }
    filters.userId = userId;
  }

  if (query.cityId != null) {
    const cityId = Number(query.cityId);
    if (!Number.isInteger(cityId) || cityId <= 0) {
      throw new InvalidFilterError(`Некорректный параметр cityId: "${query.cityId}"`);
    }
    filters.cityId = cityId;
  }

  return filters;
}

export interface SortSpec {
  field: string;
  order: 'asc' | 'desc';
}

/**
 * Парсит sortBy/sortOrder против явного whitelist полей — allowedFields
 * маппит публичное имя (из query) на настоящее SQL-выражение/алиас.
 * Значение из query НИКОГДА не подставляется в ORDER BY напрямую.
 */
export function parseSort(
  query: Record<string, unknown>,
  allowedFields: Record<string, string>,
  defaultField: string
): SortSpec {
  const sortByRaw = query.sortBy != null ? String(query.sortBy) : defaultField;
  if (!Object.prototype.hasOwnProperty.call(allowedFields, sortByRaw)) {
    throw new InvalidFilterError(
      `Некорректный параметр sortBy: "${sortByRaw}" (доступно: ${Object.keys(allowedFields).join(', ')})`
    );
  }

  const sortOrderRaw = query.sortOrder != null ? String(query.sortOrder).toLowerCase() : 'desc';
  if (sortOrderRaw !== 'asc' && sortOrderRaw !== 'desc') {
    throw new InvalidFilterError(`Некорректный параметр sortOrder: "${sortOrderRaw}" (asc|desc)`);
  }

  return { field: allowedFields[sortByRaw], order: sortOrderRaw };
}

/**
 * Применяет общие фильтры к knex query builder над таблицей receipts.
 *
 * client обязателен из-за конкретного диалект-бага: knex/sqlite3-драйвер
 * хранит datetime-колонки в SQLite как epoch-миллисекунды (integer), а не
 * текстовую дату (в отличие от MySQL, где это настоящий DATETIME) — при
 * сравнении такой INTEGER-колонки с ISO-строкой ('2026-08-20') SQLite
 * использует правила сортировки по классам хранения (INTEGER < TEXT), из-за
 * чего `date >= '...'` всегда ложно, фильтр молча не работает. Проверено на
 * живых данных. Для SQLite переводим from/to в epoch-миллисекунды в JS —
 * сравнение остаётся integer-vs-integer и может использовать индекс на date.
 */
export function applyFilters(
  qb: Knex.QueryBuilder,
  filters: AnalyticsFilters,
  client: SqlClient
): Knex.QueryBuilder {
  const dateValue = (iso: string): string | number => {
    if (client === 'sqlite') return new Date(iso).getTime();
    return iso;
  };

  if (filters.from) qb.where('receipts.date', '>=', dateValue(filters.from));
  if (filters.to) qb.where('receipts.date', '<=', dateValue(filters.to));
  if (filters.status) qb.where('receipts.verification_status', filters.status);
  if (filters.ofdType) qb.where('receipts.ofd_type', filters.ofdType);
  if (filters.userId) {
    qb.whereExists(function (this: Knex.QueryBuilder) {
      this.select(1)
        .from('receipts_user_lnk')
        .whereRaw('receipts_user_lnk.receipt_id = receipts.id')
        .andWhere('receipts_user_lnk.user_id', filters.userId);
    });
  }
  if (filters.cityId) {
    // Receipt.organizationCity — город точки продажи, НЕ User.city.
    qb.whereExists(function (this: Knex.QueryBuilder) {
      this.select(1)
        .from('receipts_organization_city_lnk')
        .whereRaw('receipts_organization_city_lnk.receipt_id = receipts.id')
        .andWhere('receipts_organization_city_lnk.city_id', filters.cityId);
    });
  }
  return qb;
}

export interface LimitOffset {
  limit: number;
  offset: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** limit/offset — для /analytics/users. */
export function parseLimitOffset(query: Record<string, unknown>): LimitOffset {
  let limit = DEFAULT_LIMIT;
  if (query.limit != null) {
    limit = Number(query.limit);
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new InvalidFilterError(`Некорректный параметр limit: "${query.limit}"`);
    }
    limit = Math.min(limit, MAX_LIMIT);
  }

  let offset = 0;
  if (query.offset != null) {
    offset = Number(query.offset);
    if (!Number.isInteger(offset) || offset < 0) {
      throw new InvalidFilterError(`Некорректный параметр offset: "${query.offset}"`);
    }
  }

  return { limit, offset };
}

export interface PageInfo {
  page: number;
  pageSize: number;
  offset: number;
}

/** page/pageSize — для /analytics/users/:id/receipts. */
export function parsePagination(query: Record<string, unknown>): PageInfo {
  let page = 1;
  if (query.page != null) {
    page = Number(query.page);
    if (!Number.isInteger(page) || page <= 0) {
      throw new InvalidFilterError(`Некорректный параметр page: "${query.page}"`);
    }
  }

  let pageSize = DEFAULT_LIMIT;
  if (query.pageSize != null) {
    pageSize = Number(query.pageSize);
    if (!Number.isInteger(pageSize) || pageSize <= 0) {
      throw new InvalidFilterError(`Некорректный параметр pageSize: "${query.pageSize}"`);
    }
    pageSize = Math.min(pageSize, MAX_LIMIT);
  }

  return { page, pageSize, offset: (page - 1) * pageSize };
}

export interface ComparePeriods {
  current: AnalyticsFilters;
  previous: AnalyticsFilters;
}

/**
 * currentFrom/currentTo/previousFrom/previousTo обязательны — сравнение
 * периодов без них не имеет смысла. status/ofdType/userId/cityId (если
 * переданы) применяются одинаково к обоим периодам.
 */
export function parseCompareFilters(query: Record<string, unknown>): ComparePeriods {
  const requiredDate = (key: string): string => {
    const raw = query[key];
    if (raw == null) {
      throw new InvalidFilterError(`Параметр ${key} обязателен для сравнения периодов`);
    }
    const value = String(raw);
    if (!ISO_DATE_RE.test(value)) {
      throw new InvalidFilterError(`Некорректный параметр ${key}: "${value}" (ожидается ISO-дата)`);
    }
    return value;
  };

  const shared = parseFilters(query);
  delete shared.from;
  delete shared.to;

  return {
    current: { ...shared, from: requiredDate('currentFrom'), to: requiredDate('currentTo') },
    previous: { ...shared, from: requiredDate('previousFrom'), to: requiredDate('previousTo') },
  };
}
