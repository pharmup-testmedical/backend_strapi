import { useFetchClient } from '@strapi/strapi/admin';

/**
 * Общие фильтры — те же query-параметры, что принимают все /analytics/*
 * эндпоинты на бэкенде (src/analytics/filters.ts). cityId фильтрует по
 * Receipt.organizationCity (город точки продажи), НЕ по User.city.
 */
export interface AnalyticsFilters {
  from?: string;
  to?: string;
  status?: string;
  ofdType?: string;
  userId?: number;
  cityId?: number;
}

export interface OverviewData {
  receiptsCount: number;
  totalAmount: number;
  avgAmount: number;
  totalCashback: number;
  avgCashback: number;
  uniqueUsers: number;
}

export interface DailyPoint {
  day: string;
  count: number;
  sum: number;
}

export interface CashbackDailyPoint {
  day: string;
  cashback: number;
}

export interface StatusRow {
  status: string;
  group: string;
  count: number;
  sum: number;
}

export interface WeekdayPoint {
  weekday: number;
  count: number;
  sum: number;
}

export interface HourlyPoint {
  hour: number;
  count: number;
  sum: number;
}

export interface PlatformRow {
  platform: string | null;
  receiptsCount: number;
  totalAmount: number;
  uniqueUsers: number;
}

export interface CityOption {
  cityId: number;
  cityName: string;
}

export interface CityRow {
  cityId: number | null;
  cityName: string;
  receiptsCount: number;
  totalAmount: number;
  uniqueUsers: number;
  totalCashback: number;
}

export interface OfdRow {
  ofdType: string;
  receiptsCount: number;
  totalAmount: number;
  totalCashback: number;
  uniqueUsers: number;
  verifiedCount: number;
  partiallyVerifiedCount: number;
  rejectedCount: number;
  rejectedLateCount: number;
  pendingCount: number;
}

export interface DemographicsData {
  totalUsers: number;
  ageGroups: { group: string; count: number }[];
  genders: { gender: string; count: number }[];
}

export interface AppVersionRow {
  appVersion: string | null;
  receiptsCount: number;
  totalAmount: number;
  uniqueUsers: number;
}

export interface AppVersionTrendPoint {
  period: string;
  appVersion: string | null;
  count: number;
}

export type SortOrder = 'asc' | 'desc';

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
}

export interface UserRow {
  userId: number;
  name: string | null;
  phone: string | null;
  userCity: string | null;
  receiptsCount: number;
  totalAmount: number;
  avgAmount: number;
  totalCashback: number;
  activeDays: number;
  firstReceiptDate: string | null;
  lastReceiptDate: string | null;
}

export interface UserDetail {
  userId: number;
  name: string | null;
  phone: string | null;
  userCity: string | null;
  receiptsCount: number;
  totalAmount: number;
  avgAmount: number;
  totalCashback: number;
  activeDays: number;
  firstReceiptDate: string | null;
  lastReceiptDate: string | null;
  statuses: Record<string, number>;
}

export interface UserDailyPoint {
  date: string;
  count: number;
  amount: number;
  cashback: number;
}

export interface UserCityRow {
  cityId: number | null;
  cityName: string;
  receiptsCount: number;
  totalAmount: number;
  totalCashback: number;
}

export interface CatalogFilters {
  groupId?: number;
  categoryId?: number;
  productId?: number;
  supplierId?: number;
}

export interface ProductRow {
  productId: number;
  productName: string | null;
  article: string | null;
  groupId: number | null;
  groupName: string | null;
  categoryId: number | null;
  categoryName: string | null;
  receiptsCount: number;
  quantity: number;
  totalAmount: number;
  totalCashback: number;
}

export interface GroupRow {
  groupId: number;
  groupName: string;
  productsCount: number;
  receiptsCount: number;
  quantity: number;
  totalAmount: number;
  totalCashback: number;
}

export interface CategoryRow {
  categoryId: number;
  categoryName: string;
  groupId: number | null;
  groupName: string | null;
  productsCount: number;
  receiptsCount: number;
  quantity: number;
  totalAmount: number;
  totalCashback: number;
}

export interface SupplierRow {
  supplierId: number;
  supplierName: string;
  productsCount: number;
  receiptsCount: number;
  totalAmount: number;
  totalCashback: number;
}

export interface PeriodStats {
  receiptsCount: number;
  totalAmount: number;
  avgAmount: number;
  totalCashback: number;
  avgCashback: number;
  uniqueUsers: number;
}

export interface CompareData {
  current: PeriodStats;
  previous: PeriodStats;
  change: {
    receiptsChangePercent: number | null;
    amountChangePercent: number | null;
    avgAmountChangePercent: number | null;
    usersChangePercent: number | null;
    cashbackChangePercent: number | null;
  };
}

export interface UserReceiptRow {
  receiptId: string;
  date: string;
  totalAmount: number;
  cashback: number;
  verificationStatus: string;
  ofdType: string;
  organizationName: string | null;
  organizationAddress: string | null;
  organizationCity: string | null;
  itemsCount: number;
}

const buildQuery = (filters: object): string => {
  const params = new URLSearchParams();
  Object.entries(filters as Record<string, unknown>).forEach(([key, value]) => {
    if (value != null && value !== '') params.set(key, String(value));
  });
  const qs = params.toString();
  return qs ? `?${qs}` : '';
};

/**
 * Хук, а не голые функции — useFetchClient() сам является React-хуком
 * (читает JWT/backendURL из контекста админки), вызывать его можно только
 * внутри тела компонента. Возвращает набор типизированных обёрток под
 * каждый нужный Обзору /analytics/* эндпоинт.
 */
export function useAnalyticsApi() {
  const { get } = useFetchClient();

  return {
    async getOverview(filters: AnalyticsFilters): Promise<OverviewData> {
      const { data } = await get(`/analytics/overview${buildQuery(filters)}`);
      return data.data;
    },
    async getReceiptsDaily(filters: AnalyticsFilters): Promise<DailyPoint[]> {
      const { data } = await get(`/analytics/receipts-daily${buildQuery(filters)}`);
      return data.data;
    },
    async getCashbackDaily(filters: AnalyticsFilters): Promise<CashbackDailyPoint[]> {
      const { data } = await get(`/analytics/cashback-daily${buildQuery(filters)}`);
      return data.data;
    },
    async getStatuses(filters: AnalyticsFilters): Promise<StatusRow[]> {
      const { data } = await get(`/analytics/statuses${buildQuery(filters)}`);
      return data.data;
    },
    async getWeekday(filters: AnalyticsFilters): Promise<WeekdayPoint[]> {
      const { data } = await get(`/analytics/weekday${buildQuery(filters)}`);
      return data.data;
    },
    async getHourly(filters: AnalyticsFilters): Promise<HourlyPoint[]> {
      const { data } = await get(`/analytics/hourly${buildQuery(filters)}`);
      return data.data;
    },
    async getPlatforms(filters: AnalyticsFilters): Promise<{ data: PlatformRow[]; note: string }> {
      const { data } = await get(`/analytics/platforms${buildQuery(filters)}`);
      return data;
    },
    async getCitiesList(): Promise<CityOption[]> {
      const { data } = await get('/analytics/meta/cities');
      return data.data;
    },
    async getCities(
      filters: AnalyticsFilters,
      sortBy: string = 'receiptsCount',
      sortOrder: SortOrder = 'desc'
    ): Promise<CityRow[]> {
      const qs = buildQuery(filters);
      const sep = qs ? '&' : '?';
      const { data } = await get(`/analytics/cities${qs}${sep}sortBy=${sortBy}&sortOrder=${sortOrder}`);
      return data.data;
    },
    async getOfd(filters: AnalyticsFilters): Promise<OfdRow[]> {
      const { data } = await get(`/analytics/ofd${buildQuery(filters)}`);
      return data.data;
    },
    async getDemographics(filters: AnalyticsFilters): Promise<DemographicsData> {
      const { data } = await get(`/analytics/demographics${buildQuery(filters)}`);
      return data.data;
    },
    async getAppVersions(filters: AnalyticsFilters): Promise<AppVersionRow[]> {
      const { data } = await get(`/analytics/app-versions${buildQuery(filters)}`);
      return data.data;
    },
    async getAppVersionsTrend(
      filters: AnalyticsFilters,
      granularity: 'day' | 'week' = 'day'
    ): Promise<AppVersionTrendPoint[]> {
      const qs = buildQuery(filters);
      const sep = qs ? '&' : '?';
      const { data } = await get(`/analytics/app-versions/trend${qs}${sep}granularity=${granularity}`);
      return data.data;
    },
    async getUsersList(
      filters: AnalyticsFilters,
      sortBy: string,
      sortOrder: SortOrder,
      limit: number,
      offset: number
    ): Promise<{ rows: UserRow[]; pagination: Pagination }> {
      const qs = buildQuery(filters);
      const sep = qs ? '&' : '?';
      const { data } = await get(
        `/analytics/users${qs}${sep}sortBy=${sortBy}&sortOrder=${sortOrder}&limit=${limit}&offset=${offset}`
      );
      return { rows: data.data, pagination: data.pagination };
    },
    async getUserDetail(userId: number, filters: AnalyticsFilters): Promise<UserDetail> {
      const { data } = await get(`/analytics/users/${userId}${buildQuery(filters)}`);
      return data.data;
    },
    async getUserDaily(userId: number, filters: AnalyticsFilters): Promise<UserDailyPoint[]> {
      const { data } = await get(`/analytics/users/${userId}/daily${buildQuery(filters)}`);
      return data.data;
    },
    async getUserCities(userId: number, filters: AnalyticsFilters): Promise<UserCityRow[]> {
      const { data } = await get(`/analytics/users/${userId}/cities${buildQuery(filters)}`);
      return data.data;
    },
    async getUserReceipts(
      userId: number,
      filters: AnalyticsFilters,
      sortBy: string,
      sortOrder: SortOrder,
      page: number,
      pageSize: number
    ): Promise<{ rows: UserReceiptRow[]; pagination: Pagination }> {
      const qs = buildQuery(filters);
      const sep = qs ? '&' : '?';
      const { data } = await get(
        `/analytics/users/${userId}/receipts${qs}${sep}sortBy=${sortBy}&sortOrder=${sortOrder}&page=${page}&pageSize=${pageSize}`
      );
      return { rows: data.data, pagination: data.pagination };
    },
    async getProducts(
      filters: AnalyticsFilters,
      catalogFilters: CatalogFilters,
      sortBy: string,
      sortOrder: SortOrder,
      limit: number,
      offset: number
    ): Promise<{ rows: ProductRow[]; pagination: Pagination }> {
      const qs = buildQuery({ ...filters, ...catalogFilters });
      const sep = qs ? '&' : '?';
      const { data } = await get(
        `/analytics/products${qs}${sep}sortBy=${sortBy}&sortOrder=${sortOrder}&limit=${limit}&offset=${offset}`
      );
      return { rows: data.data, pagination: data.pagination };
    },
    async getGroups(
      filters: AnalyticsFilters,
      catalogFilters: CatalogFilters,
      sortBy: string,
      sortOrder: SortOrder
    ): Promise<GroupRow[]> {
      const qs = buildQuery({ ...filters, ...catalogFilters });
      const sep = qs ? '&' : '?';
      const { data } = await get(`/analytics/groups${qs}${sep}sortBy=${sortBy}&sortOrder=${sortOrder}`);
      return data.data;
    },
    async getCategories(
      filters: AnalyticsFilters,
      catalogFilters: CatalogFilters,
      sortBy: string,
      sortOrder: SortOrder,
      limit: number,
      offset: number
    ): Promise<{ rows: CategoryRow[]; pagination: Pagination }> {
      const qs = buildQuery({ ...filters, ...catalogFilters });
      const sep = qs ? '&' : '?';
      const { data } = await get(
        `/analytics/categories${qs}${sep}sortBy=${sortBy}&sortOrder=${sortOrder}&limit=${limit}&offset=${offset}`
      );
      return { rows: data.data, pagination: data.pagination };
    },
    async getSuppliers(
      filters: AnalyticsFilters,
      catalogFilters: CatalogFilters,
      sortBy: string,
      sortOrder: SortOrder
    ): Promise<SupplierRow[]> {
      const qs = buildQuery({ ...filters, ...catalogFilters });
      const sep = qs ? '&' : '?';
      const { data } = await get(`/analytics/suppliers${qs}${sep}sortBy=${sortBy}&sortOrder=${sortOrder}`);
      return data.data;
    },
    async getCompare(
      filters: AnalyticsFilters,
      currentFrom: string,
      currentTo: string,
      previousFrom: string,
      previousTo: string
    ): Promise<CompareData> {
      const qs = buildQuery({
        ...filters,
        from: undefined,
        to: undefined,
        currentFrom,
        currentTo,
        previousFrom,
        previousTo,
      });
      const { data } = await get(`/analytics/compare${qs}`);
      return data.data;
    },
  };
}
