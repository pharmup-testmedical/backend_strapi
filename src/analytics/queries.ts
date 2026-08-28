import type { Core } from '@strapi/strapi';
import { getSqlClient, dayExpr, weekdayExpr, hourExpr, weekExpr } from './db';
import {
  applyFilters,
  VERIFICATION_STATUSES,
  type AnalyticsFilters,
  type SortSpec,
  type LimitOffset,
  type PageInfo,
} from './filters';
import { classifyStatus, statusGroupCountExpr } from './status-groups';
import { parseIin, ageGroupFor, AGE_GROUPS } from './iin';

export const CITIES_SORT_FIELDS: Record<string, string> = {
  receiptsCount: 'receipts_count',
  totalAmount: 'total_amount',
  uniqueUsers: 'unique_users',
  totalCashback: 'total_cashback',
};

export const USERS_SORT_FIELDS: Record<string, string> = {
  receiptsCount: 'receipts_count',
  totalAmount: 'total_amount',
  avgAmount: 'avg_amount',
  totalCashback: 'total_cashback',
  activeDays: 'active_days',
  firstReceiptDate: 'first_receipt_date',
  lastReceiptDate: 'last_receipt_date',
};

export const USER_RECEIPTS_SORT_FIELDS: Record<string, string> = {
  date: 'receipts.date',
  totalAmount: 'receipts.total_amount',
  cashback: 'receipts.final_cashback',
};

const num = (v: unknown): number => Number(v ?? 0);

/**
 * receipts.date для SQLite приходит из knex как epoch-миллисекунды
 * (integer), для MySQL — как Date/строка от mysql2. Приводим к единому
 * ISO-формату для ответа API независимо от диалекта.
 */
const isoDate = (v: unknown): string | null => {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'number') return new Date(v).toISOString();
  return String(v);
};

export async function getOverview(strapi: Core.Strapi, filters: AnalyticsFilters) {
  const knex = strapi.db.connection;
  const client = getSqlClient(strapi);

  const totalsQuery = applyFilters(
    knex('receipts').select(
      knex.raw('COUNT(*) as receipts_count'),
      knex.raw('COALESCE(SUM(total_amount), 0) as total_amount'),
      knex.raw('COALESCE(AVG(total_amount), 0) as avg_amount'),
      knex.raw('COALESCE(SUM(final_cashback), 0) as total_cashback'),
      knex.raw('COALESCE(AVG(final_cashback), 0) as avg_cashback')
    ),
    filters,
    client
  );

  const uniqueUsersQuery = applyFilters(
    knex('receipts')
      .join('receipts_user_lnk', 'receipts_user_lnk.receipt_id', 'receipts.id')
      .countDistinct('receipts_user_lnk.user_id as unique_users'),
    filters,
    client
  );

  const [[totals], [{ unique_users }]] = await Promise.all([totalsQuery, uniqueUsersQuery]);

  return {
    receiptsCount: num(totals.receipts_count),
    totalAmount: num(totals.total_amount),
    avgAmount: num(totals.avg_amount),
    totalCashback: num(totals.total_cashback),
    avgCashback: num(totals.avg_cashback),
    uniqueUsers: num(unique_users),
  };
}

export async function getReceiptsDaily(strapi: Core.Strapi, filters: AnalyticsFilters) {
  const knex = strapi.db.connection;
  const client = getSqlClient(strapi);
  const day = dayExpr(client, 'receipts.date');

  const rows = await applyFilters(
    knex('receipts')
      .select(knex.raw(`${day} as day`))
      .select(
        knex.raw('COUNT(*) as count'),
        knex.raw('COALESCE(SUM(total_amount), 0) as sum')
      )
      .groupByRaw(day)
      .orderByRaw(day),
    filters,
    client
  );

  return rows.map((r: any) => ({ day: r.day, count: num(r.count), sum: num(r.sum) }));
}

export async function getCashbackDaily(strapi: Core.Strapi, filters: AnalyticsFilters) {
  const knex = strapi.db.connection;
  const client = getSqlClient(strapi);
  const day = dayExpr(client, 'receipts.date');

  const rows = await applyFilters(
    knex('receipts')
      .select(knex.raw(`${day} as day`))
      .select(knex.raw('COALESCE(SUM(final_cashback), 0) as cashback'))
      .groupByRaw(day)
      .orderByRaw(day),
    filters,
    client
  );

  return rows.map((r: any) => ({ day: r.day, cashback: num(r.cashback) }));
}

export async function getStatuses(strapi: Core.Strapi, filters: AnalyticsFilters) {
  const knex = strapi.db.connection;
  const client = getSqlClient(strapi);

  const rows = await applyFilters(
    knex('receipts')
      .select('verification_status as status')
      .select(
        knex.raw('COUNT(*) as count'),
        knex.raw('COALESCE(SUM(total_amount), 0) as sum')
      )
      .groupBy('verification_status'),
    filters,
    client
  );

  return rows.map((r: any) => ({
    status: r.status,
    group: classifyStatus(r.status),
    count: num(r.count),
    sum: num(r.sum),
  }));
}

export async function getWeekday(strapi: Core.Strapi, filters: AnalyticsFilters) {
  const knex = strapi.db.connection;
  const client = getSqlClient(strapi);
  const weekday = weekdayExpr(client, 'receipts.date');

  const rows = await applyFilters(
    knex('receipts')
      .select(knex.raw(`${weekday} as weekday`))
      .select(
        knex.raw('COUNT(*) as count'),
        knex.raw('COALESCE(SUM(total_amount), 0) as sum')
      )
      .groupByRaw(weekday)
      .orderByRaw(weekday),
    filters,
    client
  );

  return rows.map((r: any) => ({ weekday: num(r.weekday), count: num(r.count), sum: num(r.sum) }));
}

/**
 * Группировка по городу ТОЧКИ ПРОДАЖИ (receipts.organization_city — из
 * organizationAddress), а НЕ по городу пользователя. Receipt→City и
 * Receipt→User — обе manyToOne (один чек = максимум одна связь каждого
 * вида), поэтому JOIN с ними не размножает строки receipts; COUNT(DISTINCT
 * receipts.id) используется всё равно — явно, а не потому что здесь
 * реально есть риск fan-out.
 */
export async function getCities(strapi: Core.Strapi, filters: AnalyticsFilters, sort: SortSpec) {
  const knex = strapi.db.connection;
  const client = getSqlClient(strapi);

  const qb = knex('receipts')
    .leftJoin(
      'receipts_organization_city_lnk',
      'receipts_organization_city_lnk.receipt_id',
      'receipts.id'
    )
    .leftJoin('cities', 'cities.id', 'receipts_organization_city_lnk.city_id')
    .leftJoin('receipts_user_lnk', 'receipts_user_lnk.receipt_id', 'receipts.id')
    .select('cities.id as city_id', 'cities.name as city_name')
    .select(
      knex.raw('COUNT(DISTINCT receipts.id) as receipts_count'),
      knex.raw('COALESCE(SUM(receipts.total_amount), 0) as total_amount'),
      knex.raw('COUNT(DISTINCT receipts_user_lnk.user_id) as unique_users'),
      knex.raw('COALESCE(SUM(receipts.final_cashback), 0) as total_cashback')
    )
    .groupBy('cities.id', 'cities.name')
    .orderBy(sort.field, sort.order);

  applyFilters(qb, filters, client);

  const rows = await qb;

  return rows.map((r: any) => ({
    cityId: r.city_id ?? null,
    cityName: r.city_id != null ? r.city_name : 'Город не определён',
    receiptsCount: num(r.receipts_count),
    totalAmount: num(r.total_amount),
    uniqueUsers: num(r.unique_users),
    totalCashback: num(r.total_cashback),
  }));
}

export async function getHourly(strapi: Core.Strapi, filters: AnalyticsFilters) {
  const knex = strapi.db.connection;
  const client = getSqlClient(strapi);
  const hour = hourExpr(client, 'receipts.date');

  const rows = await applyFilters(
    knex('receipts')
      .select(knex.raw(`${hour} as hour`))
      .select(
        knex.raw('COUNT(*) as count'),
        knex.raw('COALESCE(SUM(total_amount), 0) as sum')
      )
      .groupByRaw(hour)
      .orderByRaw(hour),
    filters,
    client
  );

  return rows.map((r: any) => ({ hour: num(r.hour), count: num(r.count), sum: num(r.sum) }));
}

// ====================== USERS: LIST ======================

export interface UsersListResult {
  rows: any[];
  total: number;
}

/**
 * receipts JOIN receipts_user_lnk — manyToOne (одна связь на чек), поэтому
 * без размножения строк; COUNT(DISTINCT receipts.id) всё равно используется
 * явно. cityId (если передан в filters) фильтрует по Receipt.organizationCity
 * через applyFilters — НЕ по User.city.
 */
export async function getUsersList(
  strapi: Core.Strapi,
  filters: AnalyticsFilters,
  sort: SortSpec,
  { limit, offset }: LimitOffset
): Promise<UsersListResult> {
  const knex = strapi.db.connection;
  const client = getSqlClient(strapi);
  const day = dayExpr(client, 'receipts.date');

  const baseQuery = () => {
    const qb = knex('receipts').join('receipts_user_lnk', 'receipts_user_lnk.receipt_id', 'receipts.id');
    applyFilters(qb, filters, client);
    return qb;
  };

  const rowsQuery = baseQuery()
    .select('receipts_user_lnk.user_id as user_id')
    .select(
      knex.raw('COUNT(DISTINCT receipts.id) as receipts_count'),
      knex.raw('COALESCE(SUM(receipts.total_amount), 0) as total_amount'),
      knex.raw('COALESCE(AVG(receipts.total_amount), 0) as avg_amount'),
      knex.raw('COALESCE(SUM(receipts.final_cashback), 0) as total_cashback'),
      knex.raw(`COUNT(DISTINCT ${day}) as active_days`),
      knex.raw(`MIN(${day}) as first_receipt_date`),
      knex.raw(`MAX(${day}) as last_receipt_date`)
    )
    .groupBy('receipts_user_lnk.user_id')
    .orderBy(sort.field, sort.order)
    .limit(limit)
    .offset(offset);

  const countQuery = baseQuery().countDistinct('receipts_user_lnk.user_id as total');

  const [rows, countRows] = await Promise.all([rowsQuery, countQuery]);
  const total = num((countRows[0] as any)?.total);

  if (rows.length === 0) {
    return { rows: [], total };
  }

  const userIds = rows.map((r: any) => r.user_id);
  const userInfo = await knex('up_users')
    .leftJoin('up_users_city_lnk', 'up_users_city_lnk.user_id', 'up_users.id')
    .leftJoin('cities', 'cities.id', 'up_users_city_lnk.city_id')
    .select(
      'up_users.id as id',
      'up_users.name as name',
      'up_users.phone as phone',
      'cities.name as city_name'
    )
    .whereIn('up_users.id', userIds);

  const infoById = new Map(userInfo.map((u: any) => [u.id, u]));

  const merged = rows.map((r: any) => {
    const info: any = infoById.get(r.user_id) || {};
    return {
      userId: r.user_id,
      name: info.name ?? null,
      phone: info.phone ?? null,
      userCity: info.city_name ?? null,
      receiptsCount: num(r.receipts_count),
      totalAmount: num(r.total_amount),
      avgAmount: num(r.avg_amount),
      totalCashback: num(r.total_cashback),
      activeDays: num(r.active_days),
      firstReceiptDate: r.first_receipt_date,
      lastReceiptDate: r.last_receipt_date,
    };
  });

  return { rows: merged, total };
}

// ====================== USER DETAIL ======================

/** Базовые показатели одного пользователя — filters.userId уже задан вызывающим кодом. */
export async function getUserMetrics(strapi: Core.Strapi, filters: AnalyticsFilters) {
  const knex = strapi.db.connection;
  const client = getSqlClient(strapi);
  const day = dayExpr(client, 'receipts.date');

  const rows = await applyFilters(
    knex('receipts').select(
      knex.raw('COUNT(*) as receipts_count'),
      knex.raw('COALESCE(SUM(total_amount), 0) as total_amount'),
      knex.raw('COALESCE(AVG(total_amount), 0) as avg_amount'),
      knex.raw('COALESCE(SUM(final_cashback), 0) as total_cashback'),
      knex.raw(`COUNT(DISTINCT ${day}) as active_days`),
      knex.raw(`MIN(${day}) as first_receipt_date`),
      knex.raw(`MAX(${day}) as last_receipt_date`)
    ),
    filters,
    client
  );
  const row: any = rows[0];

  return {
    receiptsCount: num(row.receipts_count),
    totalAmount: num(row.total_amount),
    avgAmount: num(row.avg_amount),
    totalCashback: num(row.total_cashback),
    activeDays: num(row.active_days),
    firstReceiptDate: row.first_receipt_date ?? null,
    lastReceiptDate: row.last_receipt_date ?? null,
  };
}

/** userId — User.city (город пользователя, НЕ город чека). */
export async function getUserInfo(strapi: Core.Strapi, userId: number) {
  const knex = strapi.db.connection;
  const row = await knex('up_users')
    .leftJoin('up_users_city_lnk', 'up_users_city_lnk.user_id', 'up_users.id')
    .leftJoin('cities', 'cities.id', 'up_users_city_lnk.city_id')
    .select(
      'up_users.id as id',
      'up_users.name as name',
      'up_users.phone as phone',
      'cities.name as city_name'
    )
    .where('up_users.id', userId)
    .first();

  if (!row) return null;

  return {
    userId: row.id,
    name: row.name ?? null,
    phone: row.phone ?? null,
    userCity: row.city_name ?? null,
  };
}

/** Разбивка по реальным значениям verification_status — все 8 ключей, без переименований. */
export async function getUserStatuses(strapi: Core.Strapi, filters: AnalyticsFilters) {
  const knex = strapi.db.connection;
  const client = getSqlClient(strapi);

  const rows = await applyFilters(
    knex('receipts').select('verification_status as status').count('* as count').groupBy('verification_status'),
    filters,
    client
  );

  const result: Record<string, number> = {};
  for (const status of VERIFICATION_STATUSES) result[status] = 0;
  for (const r of rows as any[]) {
    result[r.status] = num(r.count);
  }
  return result;
}

/** Чеки пользователя по дням. */
export async function getUserDaily(strapi: Core.Strapi, filters: AnalyticsFilters) {
  const knex = strapi.db.connection;
  const client = getSqlClient(strapi);
  const day = dayExpr(client, 'receipts.date');

  const rows = await applyFilters(
    knex('receipts')
      .select(knex.raw(`${day} as date`))
      .select(
        knex.raw('COUNT(*) as count'),
        knex.raw('COALESCE(SUM(total_amount), 0) as amount'),
        knex.raw('COALESCE(SUM(final_cashback), 0) as cashback')
      )
      .groupByRaw(day)
      .orderByRaw(day),
    filters,
    client
  );

  return rows.map((r: any) => ({
    date: r.date,
    count: num(r.count),
    amount: num(r.amount),
    cashback: num(r.cashback),
  }));
}

/** Чеки пользователя по Receipt.organizationCity (не User.city). */
export async function getUserCities(strapi: Core.Strapi, filters: AnalyticsFilters) {
  const knex = strapi.db.connection;
  const client = getSqlClient(strapi);

  const qb = knex('receipts')
    .leftJoin(
      'receipts_organization_city_lnk',
      'receipts_organization_city_lnk.receipt_id',
      'receipts.id'
    )
    .leftJoin('cities', 'cities.id', 'receipts_organization_city_lnk.city_id')
    .select('cities.id as city_id', 'cities.name as city_name')
    .select(
      knex.raw('COUNT(DISTINCT receipts.id) as receipts_count'),
      knex.raw('COALESCE(SUM(receipts.total_amount), 0) as total_amount'),
      knex.raw('COALESCE(SUM(receipts.final_cashback), 0) as total_cashback')
    )
    .groupBy('cities.id', 'cities.name')
    .orderBy('receipts_count', 'desc');

  applyFilters(qb, filters, client);

  const rows = await qb;

  return rows.map((r: any) => ({
    cityId: r.city_id ?? null,
    cityName: r.city_id != null ? r.city_name : 'Город не определён',
    receiptsCount: num(r.receipts_count),
    totalAmount: num(r.total_amount),
    totalCashback: num(r.total_cashback),
  }));
}

export interface UserReceiptsResult {
  rows: any[];
  total: number;
}

/**
 * itemsCount — через коррелированный скалярный subquery по receipts_cmps
 * (field='items'), не JOIN — иначе один чек с N позициями размножился бы
 * в N строк списка.
 */
export async function getUserReceipts(
  strapi: Core.Strapi,
  filters: AnalyticsFilters,
  sort: SortSpec,
  { pageSize, offset }: PageInfo
): Promise<UserReceiptsResult> {
  const knex = strapi.db.connection;
  const client = getSqlClient(strapi);

  const baseQuery = () => {
    const qb = knex('receipts');
    applyFilters(qb, filters, client);
    return qb;
  };

  const rowsQuery = baseQuery()
    .leftJoin(
      'receipts_organization_city_lnk',
      'receipts_organization_city_lnk.receipt_id',
      'receipts.id'
    )
    .leftJoin('cities', 'cities.id', 'receipts_organization_city_lnk.city_id')
    .select(
      'receipts.document_id as receipt_id',
      'receipts.date as date',
      'receipts.total_amount as total_amount',
      'receipts.final_cashback as cashback',
      'receipts.verification_status as verification_status',
      'receipts.ofd_type as ofd_type',
      'receipts.organization_name as organization_name',
      'receipts.organization_address as organization_address',
      'cities.name as organization_city'
    )
    .select(
      knex.raw(
        `(SELECT COUNT(*) FROM receipts_cmps WHERE receipts_cmps.entity_id = receipts.id AND receipts_cmps.field = 'items') as items_count`
      )
    )
    .orderBy(sort.field, sort.order)
    .limit(pageSize)
    .offset(offset);

  const countQuery = baseQuery().count('* as total');

  const [rows, countRows] = await Promise.all([rowsQuery, countQuery]);
  const total = num((countRows[0] as any)?.total);

  return {
    rows: rows.map((r: any) => ({
      receiptId: r.receipt_id,
      date: isoDate(r.date),
      totalAmount: num(r.total_amount),
      cashback: num(r.cashback),
      verificationStatus: r.verification_status,
      ofdType: r.ofd_type,
      organizationName: r.organization_name,
      organizationAddress: r.organization_address,
      organizationCity: r.organization_city ?? null,
      itemsCount: num(r.items_count),
    })),
    total,
  };
}

// ====================== OFD ======================

/**
 * Статусные счётчики строятся из единого STATUS_GROUPS (status-groups.ts) —
 * 5 групп, не 3: verified/partiallyVerified/rejected/rejectedLate/pending.
 * totalAmount/totalCashback считаются по ВСЕМ чекам независимо от статуса —
 * группировка статусов на суммы не влияет (частично подтверждённые и
 * отклонённые по опозданию учтены в суммах по факту, как и остальные).
 */
export async function getOfd(strapi: Core.Strapi, filters: AnalyticsFilters) {
  const knex = strapi.db.connection;
  const client = getSqlClient(strapi);

  const qb = knex('receipts')
    .leftJoin('receipts_user_lnk', 'receipts_user_lnk.receipt_id', 'receipts.id')
    .select('receipts.ofd_type as ofd_type')
    .select(
      knex.raw('COUNT(DISTINCT receipts.id) as receipts_count'),
      knex.raw('COALESCE(SUM(receipts.total_amount), 0) as total_amount'),
      knex.raw('COALESCE(SUM(receipts.final_cashback), 0) as total_cashback'),
      knex.raw('COUNT(DISTINCT receipts_user_lnk.user_id) as unique_users'),
      knex.raw(`${statusGroupCountExpr('receipts.verification_status', 'verified')} as verified_count`),
      knex.raw(
        `${statusGroupCountExpr('receipts.verification_status', 'partiallyVerified')} as partially_verified_count`
      ),
      knex.raw(`${statusGroupCountExpr('receipts.verification_status', 'rejected')} as rejected_count`),
      knex.raw(`${statusGroupCountExpr('receipts.verification_status', 'rejectedLate')} as rejected_late_count`),
      knex.raw(`${statusGroupCountExpr('receipts.verification_status', 'pending')} as pending_count`)
    )
    .groupBy('receipts.ofd_type')
    .orderBy('receipts_count', 'desc');

  applyFilters(qb, filters, client);

  const rows = await qb;

  return rows.map((r: any) => ({
    ofdType: r.ofd_type,
    receiptsCount: num(r.receipts_count),
    totalAmount: num(r.total_amount),
    totalCashback: num(r.total_cashback),
    uniqueUsers: num(r.unique_users),
    verifiedCount: num(r.verified_count),
    partiallyVerifiedCount: num(r.partially_verified_count),
    rejectedCount: num(r.rejected_count),
    rejectedLateCount: num(r.rejected_late_count),
    pendingCount: num(r.pending_count),
  }));
}

// ====================== PERIOD COMPARISON ======================

const pctChange = (current: number, previous: number): number | null => {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 10000) / 100;
};

export async function getCompare(strapi: Core.Strapi, current: AnalyticsFilters, previous: AnalyticsFilters) {
  const [currentStats, previousStats] = await Promise.all([
    getOverview(strapi, current),
    getOverview(strapi, previous),
  ]);

  return {
    current: currentStats,
    previous: previousStats,
    change: {
      receiptsChangePercent: pctChange(currentStats.receiptsCount, previousStats.receiptsCount),
      amountChangePercent: pctChange(currentStats.totalAmount, previousStats.totalAmount),
      avgAmountChangePercent: pctChange(currentStats.avgAmount, previousStats.avgAmount),
      usersChangePercent: pctChange(currentStats.uniqueUsers, previousStats.uniqueUsers),
      cashbackChangePercent: pctChange(currentStats.totalCashback, previousStats.totalCashback),
    },
  };
}

// ====================== PLATFORMS ======================

/**
 * platform лежит на Receipt, не на User — "уникальных пользователей по
 * платформе" значит "пользователи, отправившие хотя бы один чек с этой
 * платформы", не "пользователи, которые ТОЛЬКО с этой платформы". Один
 * человек, сменивший телефон, попадёт в обе группы — сумма uniqueUsers по
 * платформам НЕ равна общему числу уникальных пользователей. Явно
 * помечаю это в ответе через note, чтобы фронтенд не принял сумму за
 * общее число.
 */
export async function getPlatforms(strapi: Core.Strapi, filters: AnalyticsFilters) {
  const knex = strapi.db.connection;
  const client = getSqlClient(strapi);

  const qb = knex('receipts')
    .leftJoin('receipts_user_lnk', 'receipts_user_lnk.receipt_id', 'receipts.id')
    .select('receipts.platform as platform')
    .select(
      knex.raw('COUNT(DISTINCT receipts.id) as receipts_count'),
      knex.raw('COALESCE(SUM(receipts.total_amount), 0) as total_amount'),
      knex.raw('COUNT(DISTINCT receipts_user_lnk.user_id) as unique_users')
    )
    .groupBy('receipts.platform')
    .orderBy('receipts_count', 'desc');

  applyFilters(qb, filters, client);

  const rows = await qb;

  return {
    data: rows.map((r: any) => ({
      platform: r.platform ?? null,
      receiptsCount: num(r.receipts_count),
      totalAmount: num(r.total_amount),
      uniqueUsers: num(r.unique_users),
    })),
    note:
      'uniqueUsers — пользователи, отправившие хотя бы один чек с этой платформы. ' +
      'Один и тот же пользователь может входить в обе группы (сменил устройство/ОС) — ' +
      'сумма uniqueUsers по платформам не равна общему числу уникальных пользователей.',
  };
}

// ====================== DEMOGRAPHICS ======================

/**
 * ИИН читается из up_users, но наружу не отдаётся ни он сам, ни точная
 * дата рождения — только агрегированные корзины (см. iin.ts). Список
 * пользователей сначала сужается тем же SQL-джойном/фильтрами, что и
 * /analytics/users (только пользователи с подходящими под фильтры чеками),
 * затем для ЭТОГО уже небольшого множества (число пользователей, не
 * чеков) читается iin и классифицируется в JS — сам парсинг ИИН
 * принципиально не SQL-логика, вынести её в GROUP BY нельзя.
 */
export async function getDemographics(strapi: Core.Strapi, filters: AnalyticsFilters) {
  const knex = strapi.db.connection;
  const client = getSqlClient(strapi);

  const userIdsQuery = knex('receipts')
    .join('receipts_user_lnk', 'receipts_user_lnk.receipt_id', 'receipts.id')
    .distinct('receipts_user_lnk.user_id as user_id');
  applyFilters(userIdsQuery, filters, client);

  const userIdRows = await userIdsQuery;
  const userIds = userIdRows.map((r: any) => r.user_id);

  const ageGroups: Record<string, number> = {};
  for (const g of AGE_GROUPS) ageGroups[g] = 0;
  ageGroups.unknown = 0;

  const genders: Record<string, number> = { male: 0, female: 0, unknown: 0 };

  if (userIds.length > 0) {
    const iinRows = await knex('up_users').select('id', 'iin').whereIn('id', userIds);

    for (const row of iinRows as any[]) {
      const info = parseIin(row.iin);
      ageGroups[ageGroupFor(info)]++;
      genders[info ? info.gender : 'unknown']++;
    }
  }

  return {
    totalUsers: userIds.length,
    ageGroups: Object.entries(ageGroups).map(([group, count]) => ({ group, count })),
    genders: Object.entries(genders).map(([gender, count]) => ({ gender, count })),
  };
}

// ====================== APP VERSIONS ======================

/**
 * Receipt.appVersion — строка на каждом чеке (валидируется как X.Y.Z при
 * сохранении, см. receipt.ts), НЕ на User — историческая динамика возможна
 * именно поэтому. null включён отдельной строкой (старые чеки до того, как
 * поле стало заполняться) — не скрываю молча.
 */
export async function getAppVersions(strapi: Core.Strapi, filters: AnalyticsFilters) {
  const knex = strapi.db.connection;
  const client = getSqlClient(strapi);

  const qb = knex('receipts')
    .leftJoin('receipts_user_lnk', 'receipts_user_lnk.receipt_id', 'receipts.id')
    .select('receipts.app_version as app_version')
    .select(
      knex.raw('COUNT(DISTINCT receipts.id) as receipts_count'),
      knex.raw('COALESCE(SUM(receipts.total_amount), 0) as total_amount'),
      knex.raw('COUNT(DISTINCT receipts_user_lnk.user_id) as unique_users')
    )
    .groupBy('receipts.app_version')
    .orderBy('receipts_count', 'desc');

  applyFilters(qb, filters, client);

  const rows = await qb;

  return rows.map((r: any) => ({
    appVersion: r.app_version ?? null,
    receiptsCount: num(r.receipts_count),
    totalAmount: num(r.total_amount),
    uniqueUsers: num(r.unique_users),
  }));
}

export type TrendGranularity = 'day' | 'week';

/**
 * Динамика долей версий по периодам — {period, appVersion, count} на
 * каждую комбинацию. Не решаю сам, какая версия "новая" (это меняется с
 * каждым релизом) — отдаю сырое распределение по датам, долю новой версии
 * фронтенд считает сам, сравнивая нужную ему версию с суммой остальных.
 */
export async function getAppVersionsTrend(
  strapi: Core.Strapi,
  filters: AnalyticsFilters,
  granularity: TrendGranularity
) {
  const knex = strapi.db.connection;
  const client = getSqlClient(strapi);
  const period = granularity === 'week' ? weekExpr(client, 'receipts.date') : dayExpr(client, 'receipts.date');

  const qb = knex('receipts')
    .select(knex.raw(`${period} as period`))
    .select('receipts.app_version as app_version')
    .select(knex.raw('COUNT(DISTINCT receipts.id) as count'))
    .groupByRaw(`${period}, receipts.app_version`)
    .orderByRaw(`${period}`);

  applyFilters(qb, filters, client);

  const rows = await qb;

  return rows.map((r: any) => ({
    period: r.period,
    appVersion: r.app_version ?? null,
    count: num(r.count),
  }));
}

// ====================== META (для UI-фильтров дашборда) ======================

/** Справочник городов для выпадающего списка в фильтрах — без этого фильтр cityId пришлось бы вводить числом вручную. */
export async function getCitiesList(strapi: Core.Strapi) {
  const knex = strapi.db.connection;
  const rows = await knex('cities').select('id', 'name').orderBy('name', 'asc');
  return rows.map((r: any) => ({ cityId: r.id, cityName: r.name }));
}
