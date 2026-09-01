import { useFetchClient } from '@strapi/strapi/admin';

export interface UserSearchRow {
  id: number;
  documentId: string;
  name: string | null;
  surname: string | null;
  phone: string | null;
  email: string | null;
  account: number;
}

export interface BalanceAccount {
  stored: number;
  recomputed: number;
  mismatch: boolean;
}

export interface ItemRateMismatch {
  receiptId: string;
  receiptFiscalId: string | null;
  itemId: number;
  itemName: string;
  quantity: number;
  cashbackPerUnit: number;
  productCashbackAmount: number | null;
}

export interface BalanceSummary {
  user: { id: number; name: string | null; surname: string | null; phone: string | null; email: string | null };
  account: BalanceAccount;
  totalEarned: number;
  available: number;
  expected: number;
  processing: number;
  withdrawn: number;
  itemRateMismatchCount: number;
  itemRateMismatches: ItemRateMismatch[];
}

export interface ReceiptItemBreakdown {
  id: number;
  name: string;
  claimedProductName: string | null;
  quantity: number;
  cashbackPerUnit: number;
  cashbackTotal: number;
  verificationStatus: string;
  productCashbackAmount: number | null;
  rateMismatch: boolean;
}

export interface ReceiptRow {
  id: number;
  documentId: string;
  fiscalId: string | null;
  date: string | null;
  totalAmount: number;
  itemsCount: number;
  verificationStatus: string;
  statusLabel: string;
  confirmedCashback: number;
  pendingCashback: number;
  items: ReceiptItemBreakdown[];
}

export interface TransactionRow {
  id: string;
  kind: string;
  title: string;
  amount: number;
  date: string | null;
  statusLabel: string;
  sourceReceiptId?: string;
  sourceFiscalId?: string | null;
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
}

/**
 * Хук, а не голые функции — useFetchClient() сам является React-хуком (тот
 * же паттерн, что src/admin/pages/analytics/api.ts).
 */
export function useUserVerificationApi() {
  const { get } = useFetchClient();

  return {
    async search(q: string): Promise<UserSearchRow[]> {
      const { data } = await get(`/user-verification/search?q=${encodeURIComponent(q)}`);
      return data.data;
    },
    async getSummary(userId: number): Promise<BalanceSummary> {
      const { data } = await get(`/user-verification/${userId}/summary`);
      return data.data;
    },
    async getReceipts(
      userId: number,
      page: number,
      pageSize: number,
      status?: string
    ): Promise<{ rows: ReceiptRow[]; pagination: Pagination }> {
      const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (status) qs.set('status', status);
      const { data } = await get(`/user-verification/${userId}/receipts?${qs.toString()}`);
      return { rows: data.data, pagination: data.pagination };
    },
    async getTransactions(
      userId: number,
      page: number,
      pageSize: number,
      kind?: string
    ): Promise<{ rows: TransactionRow[]; pagination: Pagination }> {
      const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (kind) qs.set('kind', kind);
      const { data } = await get(`/user-verification/${userId}/transactions?${qs.toString()}`);
      return { rows: data.data, pagination: data.pagination };
    },
  };
}
