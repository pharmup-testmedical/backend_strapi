import type { Core } from '@strapi/strapi';

/**
 * Независимый пересчёт баланса/чеков/транзакций пользователя — эталон для
 * сверки с тем, что показывает мобильное приложение. Сознательно НЕ
 * переиспользует calculateUserBalance() (src/utils/calculate-user-balance.ts):
 * та функция при подсчёте частично подтверждённых чеков суммирует
 * item.cashback БЕЗ умножения на item.props.quantity — если переиспользовать
 * её здесь, страница-эталон унаследовала бы тот же баг и перестала бы быть
 * независимой проверкой. Все формулы ниже посчитаны заново, с умножением на
 * quantity везде, где оно требуется.
 */

const CONFIRMED_ITEM_STATUSES = [
  'auto_verified_canon',
  'auto_verified_alias',
  'auto_verified_ntin',
  'manually_verified_alias',
];

const FULLY_VERIFIED_RECEIPT_STATUSES = ['auto_verified', 'manually_verified'];
const PARTIALLY_VERIFIED_RECEIPT_STATUSES = ['auto_partially_verified', 'manually_partially_verified'];

const RECEIPT_STATUS_LABELS: Record<string, string> = {
  auto_verified: 'Подтверждён системой',
  manually_verified: 'Подтверждён администратором',
  manual_review: 'Ожидает проверки администратором',
  auto_rejected_late_submission: 'Истёк срок годности',
  auto_rejected: 'Отклонён',
  manually_rejected: 'Отклонён',
  auto_partially_verified: 'Частично подтверждён (система)',
  manually_partially_verified: 'Частично подтверждён (администратор)',
};

const WITHDRAW_STATUS_LABEL: Record<string, string> = {
  pending: 'В обработке',
  approved: 'Одобрен',
  rejected: 'Отклонён',
  manual_review: 'На проверке',
};

const WITHDRAW_KIND: Record<string, string> = {
  pending: 'withdraw_pending',
  approved: 'withdraw_approved',
  rejected: 'withdraw_rejected',
  manual_review: 'withdraw_manual_review',
};

const TASK_LABEL: Record<string, string> = {
  sendInvitations: 'Бонус за приглашение коллеги',
  leaveRating: 'Бонус за отзыв',
  scanFirstReceipts: 'Бонус за первые чеки',
};

// Плавающая погрешность decimal-полей — не считаем расхождением разницу
// меньше копейки.
const EPSILON = 0.01;

interface RawItem {
  id: number;
  __component: string;
  name?: string;
  cashback?: number;
  verificationStatus?: string;
  props?: { quantity?: number } | null;
  claimedProduct?: { cashbackAmount?: number; canonicalName?: string } | null;
}

interface RawReceipt {
  id: number;
  documentId: string;
  fiscalId?: string;
  date?: string;
  createdAt?: string;
  totalAmount?: number;
  finalCashback?: number;
  verificationStatus: string;
  items?: RawItem[];
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

export interface ReceiptSummary {
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
  account: { stored: number; recomputed: number; mismatch: boolean };
  totalEarned: number;
  available: number;
  expected: number;
  processing: number;
  withdrawn: number;
  itemRateMismatchCount: number;
  itemRateMismatches: ItemRateMismatch[];
}

function computeReceiptSummary(receipt: RawReceipt): ReceiptSummary {
  const rawItems = (receipt.items ?? []).filter((it) => it.__component === 'receipt-item.item');

  const items: ReceiptItemBreakdown[] = rawItems.map((item) => {
    const quantity = item.props?.quantity ?? 1;
    const cashbackPerUnit = item.cashback ?? 0;
    const productCashbackAmount = item.claimedProduct?.cashbackAmount ?? null;
    return {
      id: item.id,
      name: item.name ?? '',
      claimedProductName: item.claimedProduct?.canonicalName ?? null,
      quantity,
      cashbackPerUnit,
      cashbackTotal: cashbackPerUnit * quantity,
      verificationStatus: item.verificationStatus ?? 'manual_review',
      productCashbackAmount,
      rateMismatch:
        productCashbackAmount != null && Math.abs(productCashbackAmount - cashbackPerUnit) > EPSILON,
    };
  });

  let confirmedCashback = 0;
  if (FULLY_VERIFIED_RECEIPT_STATUSES.includes(receipt.verificationStatus)) {
    confirmedCashback = receipt.finalCashback ?? 0;
  } else if (PARTIALLY_VERIFIED_RECEIPT_STATUSES.includes(receipt.verificationStatus)) {
    confirmedCashback = items
      .filter((it) => CONFIRMED_ITEM_STATUSES.includes(it.verificationStatus))
      .reduce((sum, it) => sum + it.cashbackTotal, 0);
  }

  const pendingCashback = items
    .filter((it) => it.verificationStatus === 'manual_review')
    .reduce((sum, it) => sum + it.cashbackTotal, 0);

  return {
    id: receipt.id,
    documentId: receipt.documentId,
    fiscalId: receipt.fiscalId ?? null,
    date: receipt.date ?? receipt.createdAt ?? null,
    totalAmount: receipt.totalAmount ?? 0,
    itemsCount: rawItems.length,
    verificationStatus: receipt.verificationStatus,
    statusLabel: RECEIPT_STATUS_LABELS[receipt.verificationStatus] ?? receipt.verificationStatus,
    confirmedCashback,
    pendingCashback,
    items,
  };
}

async function fetchUserReceipts(strapi: Core.Strapi, userDocumentId: string): Promise<ReceiptSummary[]> {
  const receipts = (await strapi.documents('api::receipt.receipt').findMany({
    filters: { user: { documentId: { $eq: userDocumentId } } },
    sort: { date: 'desc' },
    populate: {
      items: {
        on: {
          'receipt-item.item': {
            populate: {
              props: true,
              claimedProduct: { fields: ['cashbackAmount', 'canonicalName'] },
            },
          },
          'receipt-item.product-claim': true,
        },
      },
    },
  })) as unknown as RawReceipt[];

  return receipts.map(computeReceiptSummary);
}

export async function getUserByNumericId(strapi: Core.Strapi, userId: number) {
  return strapi.db.query('plugin::users-permissions.user').findOne({
    where: { id: userId },
    select: ['id', 'documentId', 'name', 'surname', 'email', 'phone', 'account', 'iin'],
  }) as Promise<{
    id: number;
    documentId: string;
    name: string | null;
    surname: string | null;
    email: string | null;
    phone: string | null;
    account: number;
    iin: string | null;
  } | null>;
}

export async function searchUsers(strapi: Core.Strapi, q: string) {
  return strapi.db.query('plugin::users-permissions.user').findMany({
    where: {
      $or: [
        { name: { $containsi: q } },
        { surname: { $containsi: q } },
        { phone: { $containsi: q } },
        { email: { $containsi: q } },
        { iin: { $containsi: q } },
      ],
    },
    select: ['id', 'documentId', 'name', 'surname', 'phone', 'email', 'account'],
    limit: 20,
  });
}

export async function computeBalanceSummary(
  strapi: Core.Strapi,
  userDocumentId: string,
  storedAccount: number
): Promise<BalanceSummary> {
  const receipts = await fetchUserReceipts(strapi, userDocumentId);

  const totalConfirmedCashback = receipts.reduce((s, r) => s + r.confirmedCashback, 0);
  const totalPendingCashback = receipts.reduce((s, r) => s + r.pendingCashback, 0);

  const [completedTasks, completedTests, cashbackRequests] = await Promise.all([
    strapi.documents('api::completed-task.completed-task').findMany({
      filters: { user: { documentId: { $eq: userDocumentId } } },
      fields: ['cashback'],
    }),
    strapi.documents('api::completed-test.completed-test').findMany({
      filters: { user: { documentId: { $eq: userDocumentId } } },
      fields: ['cashback'],
    }),
    strapi.documents('api::cashback-request.cashback-request').findMany({
      filters: { requester: { documentId: { $eq: userDocumentId } } },
      fields: ['amount', 'verificationStatus'],
    }),
  ]);

  const totalTaskCashback = (completedTasks as any[]).reduce((s, t) => s + (t.cashback || 0), 0);
  const totalTestCashback = (completedTests as any[]).reduce((s, t) => s + (t.cashback || 0), 0);
  const approvedTotal = (cashbackRequests as any[])
    .filter((r) => r.verificationStatus === 'approved')
    .reduce((s, r) => s + (r.amount || 0), 0);
  const pendingWithdrawTotal = (cashbackRequests as any[])
    .filter((r) => r.verificationStatus === 'pending')
    .reduce((s, r) => s + (r.amount || 0), 0);

  // Именно то место, где calculateUserBalance() ошибается для частично
  // подтверждённых чеков (не умножает на quantity) — здесь totalConfirmedCashback
  // уже посчитан правильно внутри computeReceiptSummary().
  const recomputedAccount = totalConfirmedCashback + totalTaskCashback + totalTestCashback - approvedTotal;

  const itemRateMismatches: ItemRateMismatch[] = receipts.flatMap((r) =>
    r.items
      .filter((it) => it.rateMismatch)
      .map((it) => ({
        receiptId: r.documentId,
        receiptFiscalId: r.fiscalId,
        itemId: it.id,
        itemName: it.name,
        quantity: it.quantity,
        cashbackPerUnit: it.cashbackPerUnit,
        productCashbackAmount: it.productCashbackAmount,
      }))
  );

  return {
    account: {
      stored: storedAccount,
      recomputed: recomputedAccount,
      mismatch: Math.abs(storedAccount - recomputedAccount) > EPSILON,
    },
    totalEarned: recomputedAccount + approvedTotal,
    // Ожидается (manual_review-позиции) никогда не входит в recomputedAccount
    // (см. computeReceiptSummary — pendingCashback считается отдельно от
    // confirmedCashback), поэтому вычитание pending-заявок ниже физически не
    // может задеть «Ожидается».
    available: recomputedAccount - pendingWithdrawTotal,
    expected: totalPendingCashback,
    processing: pendingWithdrawTotal,
    withdrawn: approvedTotal,
    itemRateMismatchCount: itemRateMismatches.length,
    itemRateMismatches,
  };
}

export async function getReceiptsPage(
  strapi: Core.Strapi,
  userDocumentId: string,
  page: number,
  pageSize: number,
  status?: string
) {
  const all = await fetchUserReceipts(strapi, userDocumentId);
  const filtered = status ? all.filter((r) => r.verificationStatus === status) : all;
  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const rows = filtered.slice(start, start + pageSize);
  return { rows, pagination: { page, pageSize, total } };
}

export async function getReceiptDetail(strapi: Core.Strapi, userDocumentId: string, receiptDocumentId: string) {
  const all = await fetchUserReceipts(strapi, userDocumentId);
  return all.find((r) => r.documentId === receiptDocumentId) ?? null;
}

export async function getTransactionsFeed(strapi: Core.Strapi, userDocumentId: string): Promise<TransactionRow[]> {
  const receipts = await fetchUserReceipts(strapi, userDocumentId);
  const feed: TransactionRow[] = [];

  for (const r of receipts) {
    if (r.confirmedCashback > 0) {
      feed.push({
        id: `receipt-confirmed-${r.documentId}`,
        kind: 'cashback_confirmed',
        title: `Кэшбэк за чек №${r.fiscalId ?? r.documentId}`,
        amount: r.confirmedCashback,
        date: r.date,
        statusLabel: 'Начислено',
        sourceReceiptId: r.documentId,
        sourceFiscalId: r.fiscalId,
      });
    }
    if (r.pendingCashback > 0) {
      feed.push({
        id: `receipt-pending-${r.documentId}`,
        kind: 'cashback_pending',
        title: `Кэшбэк за чек №${r.fiscalId ?? r.documentId}`,
        amount: r.pendingCashback,
        date: r.date,
        statusLabel: 'Ожидается',
        sourceReceiptId: r.documentId,
        sourceFiscalId: r.fiscalId,
      });
    }
  }

  const [completedTasks, completedTests, cashbackRequests] = await Promise.all([
    strapi.documents('api::completed-task.completed-task').findMany({
      filters: { user: { documentId: { $eq: userDocumentId } } },
      fields: ['cashback', 'task', 'createdAt'],
    }),
    strapi.documents('api::completed-test.completed-test').findMany({
      filters: { user: { documentId: { $eq: userDocumentId } } },
      fields: ['cashback', 'createdAt'],
    }),
    strapi.documents('api::cashback-request.cashback-request').findMany({
      filters: { requester: { documentId: { $eq: userDocumentId } } },
      fields: ['amount', 'verificationStatus', 'createdAt'],
    }),
  ]);

  for (const t of completedTasks as any[]) {
    if ((t.cashback || 0) <= 0) continue;
    feed.push({
      id: `task-${t.documentId}`,
      kind: 'task',
      title: TASK_LABEL[t.task] ?? 'Бонус за задание',
      amount: t.cashback,
      date: t.createdAt,
      statusLabel: 'Начислено',
    });
  }

  for (const t of completedTests as any[]) {
    if ((t.cashback || 0) <= 0) continue;
    feed.push({
      id: `test-${t.documentId}`,
      kind: 'test',
      title: 'Бонус за пройденный тест',
      amount: t.cashback,
      date: t.createdAt,
      statusLabel: 'Начислено',
    });
  }

  for (const w of cashbackRequests as any[]) {
    feed.push({
      id: `withdraw-${w.documentId}`,
      kind: WITHDRAW_KIND[w.verificationStatus] ?? 'withdraw_pending',
      title: 'Вывод средств',
      amount: -(w.amount || 0),
      date: w.createdAt,
      statusLabel: WITHDRAW_STATUS_LABEL[w.verificationStatus] ?? w.verificationStatus,
    });
  }

  return feed.sort((a, b) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime());
}
