import type { Core } from '@strapi/strapi';
import type { Knex } from 'knex';
import { getSqlClient } from './db';
import { applyFilters, type AnalyticsFilters, type SortSpec, type LimitOffset } from './filters';

/**
 * verificationStatus позиции чека (receipt-item.item) — ДРУГОЙ enum, чем
 * Receipt.verificationStatus (см. src/components/receipt-item/item.json).
 */
export const ITEM_REJECTED_STATUSES = ['auto_rejected_alias', 'manually_rejected_alias'];
/** Ровно 4 статуса, дающих кешбэк — см. calculateFinalCashback() в receiptHelpers.ts. Не менять расчёт. */
export const ITEM_CASHBACK_STATUSES = [
  'auto_verified_canon',
  'auto_verified_alias',
  'auto_verified_ntin',
  'manually_verified_alias',
];

export interface CatalogFilters {
  groupId?: number;
  categoryId?: number;
  productId?: number;
  supplierId?: number;
}

export class InvalidCatalogFilterError extends Error {}

export function parseCatalogFilters(query: Record<string, unknown>): CatalogFilters {
  const filters: CatalogFilters = {};
  const positiveInt = (key: string): number | undefined => {
    if (query[key] == null) return undefined;
    const value = Number(query[key]);
    if (!Number.isInteger(value) || value <= 0) {
      throw new InvalidCatalogFilterError(`Некорректный параметр ${key}: "${query[key]}"`);
    }
    return value;
  };

  filters.groupId = positiveInt('groupId');
  filters.categoryId = positiveInt('categoryId');
  filters.productId = positiveInt('productId');
  filters.supplierId = positiveInt('supplierId');

  return filters;
}

const num = (v: unknown): number => Number(v ?? 0);

/**
 * Общий JOIN-хвост от receipts до products через реальную структуру Strapi
 * dynamic zone + вложенного компонента (проверено на живой БД):
 *
 *   receipts
 *     ← receipts_cmps (field='items', component_type='receipt-item.item')
 *       → components_receipt_item_items (name/verification_status/cashback)
 *         ← components_receipt_item_items_claimed_product_lnk → products
 *         ← components_receipt_item_items_cmps (field='props')
 *           → components_receipt_item_item_props (quantity/total_price/...)
 *
 * receipt-item.product-claim (несопоставленные позиции) сюда не попадают —
 * у них нет claimedProduct в принципе, поэтому JOIN их и не подхватит.
 *
 * Явно исключены item'ы в статусах auto_rejected_alias/manually_rejected_alias
 * — отклонённое сопоставление означает "это НЕ этот товар", учитывать его
 * quantity/сумму в статистике товара было бы неверно. Это решение
 * (не буквально из ТЗ) явно вынесено в отчёт.
 */
function joinClaimedItems(knex: Knex) {
  return knex('receipts')
    .join('receipts_cmps', function (this: Knex.JoinClause) {
      this.on('receipts_cmps.entity_id', '=', 'receipts.id')
        .andOnVal('receipts_cmps.field', '=', 'items')
        .andOnVal('receipts_cmps.component_type', '=', 'receipt-item.item');
    })
    .join('components_receipt_item_items', function (this: Knex.JoinClause) {
      this.on('components_receipt_item_items.id', '=', 'receipts_cmps.cmp_id').andOnNotIn(
        'components_receipt_item_items.verification_status',
        ITEM_REJECTED_STATUSES
      );
    })
    .join(
      'components_receipt_item_items_claimed_product_lnk',
      'components_receipt_item_items_claimed_product_lnk.item_id',
      'components_receipt_item_items.id'
    )
    .join('products', function (this: Knex.JoinClause) {
      // Найдено на реальном тесте: у Product включён draftAndPublish, и
      // если товар редактируется (есть черновик рядом с опубликованной
      // версией), обе строки делят один documentId. claimedProduct
      // (oneToOne) в таких случаях ссылается на ОБЕ строки сразу — эта
      // связь физически допускает несколько product_id на один item_id
      // (уникальный индекс составной: item_id+product_id, не просто
      // item_id). Без фильтра по published_at это даёт в аналитике
      // задвоенную строку одного и того же товара с одинаковыми цифрами
      // (не удвоенными — просто одна и та же строка дважды). Матчинг
      // кешбэка (validateAndFetchProducts) и так уже фильтрует
      // status:'published', так что реальная покупка физически не может
      // относиться ТОЛЬКО к черновику — фильтр тут ничего не отбрасывает,
      // кроме этого паразитного дубля.
      this.on('products.id', '=', 'components_receipt_item_items_claimed_product_lnk.product_id').andOnNotNull(
        'products.published_at'
      );
    })
    .leftJoin('components_receipt_item_items_cmps', function (this: Knex.JoinClause) {
      this.on('components_receipt_item_items_cmps.entity_id', '=', 'components_receipt_item_items.id').andOnVal(
        'components_receipt_item_items_cmps.field',
        '=',
        'props'
      );
    })
    .leftJoin(
      'components_receipt_item_item_props',
      'components_receipt_item_item_props.id',
      'components_receipt_item_items_cmps.cmp_id'
    );
}

const CASHBACK_CASE = `CASE WHEN components_receipt_item_items.verification_status IN ('${ITEM_CASHBACK_STATUSES.join("','")}') THEN components_receipt_item_items.cashback * COALESCE(components_receipt_item_item_props.quantity, 1) ELSE 0 END`;

function applyCatalogFilters(qb: Knex.QueryBuilder, filters: CatalogFilters) {
  if (filters.productId) qb.where('products.id', filters.productId);
  if (filters.categoryId) qb.where('categories.id', filters.categoryId);
  if (filters.groupId) qb.where('groups.id', filters.groupId);
  if (filters.supplierId) {
    qb.whereExists(function (this: Knex.QueryBuilder) {
      this.select(1)
        .from('product_suppliers_product_lnk')
        .join(
          'product_suppliers_supplier_lnk',
          'product_suppliers_supplier_lnk.product_supplier_id',
          'product_suppliers_product_lnk.product_supplier_id'
        )
        .whereRaw('product_suppliers_product_lnk.product_id = products.id')
        .andWhere('product_suppliers_supplier_lnk.supplier_id', filters.supplierId);
    });
  }
}

// ====================== PRODUCTS ======================

export const PRODUCTS_SORT_FIELDS: Record<string, string> = {
  article: 'products.article',
  productName: 'products.canonical_name',
  receiptsCount: 'receipts_count',
  quantity: 'quantity',
  totalAmount: 'total_amount',
  totalCashback: 'total_cashback',
};

export interface CatalogListResult {
  rows: any[];
  total: number;
}

export async function getProducts(
  strapi: Core.Strapi,
  filters: AnalyticsFilters,
  catalogFilters: CatalogFilters,
  sort: SortSpec,
  { limit, offset }: LimitOffset
): Promise<CatalogListResult> {
  const knex = strapi.db.connection;
  const client = getSqlClient(strapi);

  const baseQuery = () => {
    const qb = joinClaimedItems(knex)
      .leftJoin('products_category_lnk', 'products_category_lnk.product_id', 'products.id')
      .leftJoin('categories', 'categories.id', 'products_category_lnk.category_id')
      .leftJoin('categories_group_lnk', 'categories_group_lnk.category_id', 'categories.id')
      .leftJoin('groups', 'groups.id', 'categories_group_lnk.group_id');
    applyFilters(qb, filters, client);
    applyCatalogFilters(qb, catalogFilters);
    return qb;
  };

  const rowsQuery = baseQuery()
    .select(
      'products.id as product_id',
      'products.canonical_name as product_name',
      'products.article as article',
      'categories.id as category_id',
      'categories.name as category_name',
      'groups.id as group_id',
      'groups.name as group_name'
    )
    .select(
      knex.raw('COUNT(DISTINCT receipts.id) as receipts_count'),
      knex.raw('COALESCE(SUM(components_receipt_item_item_props.quantity), 0) as quantity'),
      knex.raw('COALESCE(SUM(components_receipt_item_item_props.total_price), 0) as total_amount'),
      knex.raw(`COALESCE(SUM(${CASHBACK_CASE}), 0) as total_cashback`)
    )
    .groupBy(
      'products.id',
      'products.canonical_name',
      'products.article',
      'categories.id',
      'categories.name',
      'groups.id',
      'groups.name'
    )
    .orderBy(sort.field, sort.order)
    .limit(limit)
    .offset(offset);

  const countQuery = baseQuery().countDistinct('products.id as total');

  const [rows, countRows] = await Promise.all([rowsQuery, countQuery]);
  const total = num((countRows[0] as any)?.total);

  return {
    rows: rows.map((r: any) => ({
      productId: r.product_id,
      productName: r.product_name,
      article: r.article,
      groupId: r.group_id ?? null,
      groupName: r.group_name ?? null,
      categoryId: r.category_id ?? null,
      categoryName: r.category_name ?? null,
      receiptsCount: num(r.receipts_count),
      quantity: num(r.quantity),
      totalAmount: num(r.total_amount),
      totalCashback: num(r.total_cashback),
    })),
    total,
  };
}

// ====================== GROUPS ======================

export const GROUPS_SORT_FIELDS: Record<string, string> = {
  groupName: 'groups.name',
  productsCount: 'products_count',
  receiptsCount: 'receipts_count',
  totalAmount: 'total_amount',
  totalCashback: 'total_cashback',
};

export async function getGroups(
  strapi: Core.Strapi,
  filters: AnalyticsFilters,
  catalogFilters: CatalogFilters,
  sort: SortSpec
) {
  const knex = strapi.db.connection;
  const client = getSqlClient(strapi);

  const qb = joinClaimedItems(knex)
    .join('products_category_lnk', 'products_category_lnk.product_id', 'products.id')
    .join('categories', 'categories.id', 'products_category_lnk.category_id')
    .join('categories_group_lnk', 'categories_group_lnk.category_id', 'categories.id')
    .join('groups', 'groups.id', 'categories_group_lnk.group_id')
    .select('groups.id as group_id', 'groups.name as group_name')
    .select(
      knex.raw('COUNT(DISTINCT products.id) as products_count'),
      knex.raw('COUNT(DISTINCT receipts.id) as receipts_count'),
      knex.raw('COALESCE(SUM(components_receipt_item_item_props.quantity), 0) as quantity'),
      knex.raw('COALESCE(SUM(components_receipt_item_item_props.total_price), 0) as total_amount'),
      knex.raw(`COALESCE(SUM(${CASHBACK_CASE}), 0) as total_cashback`)
    )
    .groupBy('groups.id', 'groups.name')
    .orderBy(sort.field, sort.order);

  applyFilters(qb, filters, client);
  applyCatalogFilters(qb, catalogFilters);

  const rows = await qb;

  return rows.map((r: any) => ({
    groupId: r.group_id,
    groupName: r.group_name,
    productsCount: num(r.products_count),
    receiptsCount: num(r.receipts_count),
    quantity: num(r.quantity),
    totalAmount: num(r.total_amount),
    totalCashback: num(r.total_cashback),
  }));
}

// ====================== CATEGORIES ======================

export const CATEGORIES_SORT_FIELDS: Record<string, string> = {
  categoryName: 'categories.name',
  productsCount: 'products_count',
  receiptsCount: 'receipts_count',
  totalAmount: 'total_amount',
  totalCashback: 'total_cashback',
};

export async function getCategories(
  strapi: Core.Strapi,
  filters: AnalyticsFilters,
  catalogFilters: CatalogFilters,
  sort: SortSpec,
  { limit, offset }: LimitOffset
): Promise<CatalogListResult> {
  const knex = strapi.db.connection;
  const client = getSqlClient(strapi);

  const baseQuery = () => {
    const qb = joinClaimedItems(knex)
      .join('products_category_lnk', 'products_category_lnk.product_id', 'products.id')
      .join('categories', 'categories.id', 'products_category_lnk.category_id')
      .leftJoin('categories_group_lnk', 'categories_group_lnk.category_id', 'categories.id')
      .leftJoin('groups', 'groups.id', 'categories_group_lnk.group_id');
    applyFilters(qb, filters, client);
    applyCatalogFilters(qb, catalogFilters);
    return qb;
  };

  const rowsQuery = baseQuery()
    .select(
      'categories.id as category_id',
      'categories.name as category_name',
      'groups.id as group_id',
      'groups.name as group_name'
    )
    .select(
      knex.raw('COUNT(DISTINCT products.id) as products_count'),
      knex.raw('COUNT(DISTINCT receipts.id) as receipts_count'),
      knex.raw('COALESCE(SUM(components_receipt_item_item_props.quantity), 0) as quantity'),
      knex.raw('COALESCE(SUM(components_receipt_item_item_props.total_price), 0) as total_amount'),
      knex.raw(`COALESCE(SUM(${CASHBACK_CASE}), 0) as total_cashback`)
    )
    .groupBy('categories.id', 'categories.name', 'groups.id', 'groups.name')
    .orderBy(sort.field, sort.order)
    .limit(limit)
    .offset(offset);

  const countQuery = baseQuery().countDistinct('categories.id as total');

  const [rows, countRows] = await Promise.all([rowsQuery, countQuery]);
  const total = num((countRows[0] as any)?.total);

  return {
    rows: rows.map((r: any) => ({
      categoryId: r.category_id,
      categoryName: r.category_name,
      groupId: r.group_id ?? null,
      groupName: r.group_name ?? null,
      productsCount: num(r.products_count),
      receiptsCount: num(r.receipts_count),
      quantity: num(r.quantity),
      totalAmount: num(r.total_amount),
      totalCashback: num(r.total_cashback),
    })),
    total,
  };
}

// ====================== SUPPLIERS ======================
// НЕ было явно запрошено как отдельный GET-эндпоинт в разделах 7-9, но
// whitelist сортировки для suppliers прямо указан в разделе 11 — добавляю
// по аналогии с groups/categories, тем же паттерном.
//
// ВАЖНО (ограничение, не буквальная ошибка): ProductSupplier — это
// каталожная связь "кто МОЖЕТ поставить товар" для будущего Заказа, а не
// то, у кого физически куплен чек (это organizationName/organizationAddress
// на Receipt, никак не связано с Supplier). receiptsCount/totalAmount тут
// означают "активность по товарам, которые этот поставщик потенциально
// может поставить", а не "продажи через этого поставщика".

export const SUPPLIERS_SORT_FIELDS: Record<string, string> = {
  supplierName: 'suppliers.name',
  productsCount: 'products_count',
  receiptsCount: 'receipts_count',
  totalAmount: 'total_amount',
  totalCashback: 'total_cashback',
};

export async function getSuppliers(
  strapi: Core.Strapi,
  filters: AnalyticsFilters,
  catalogFilters: CatalogFilters,
  sort: SortSpec
) {
  const knex = strapi.db.connection;
  const client = getSqlClient(strapi);

  const qb = joinClaimedItems(knex)
    .join('product_suppliers_product_lnk', 'product_suppliers_product_lnk.product_id', 'products.id')
    .join(
      'product_suppliers_supplier_lnk',
      'product_suppliers_supplier_lnk.product_supplier_id',
      'product_suppliers_product_lnk.product_supplier_id'
    )
    .join('suppliers', 'suppliers.id', 'product_suppliers_supplier_lnk.supplier_id')
    .select('suppliers.id as supplier_id', 'suppliers.name as supplier_name')
    .select(
      knex.raw('COUNT(DISTINCT products.id) as products_count'),
      knex.raw('COUNT(DISTINCT receipts.id) as receipts_count'),
      knex.raw('COALESCE(SUM(components_receipt_item_item_props.total_price), 0) as total_amount'),
      knex.raw(`COALESCE(SUM(${CASHBACK_CASE}), 0) as total_cashback`)
    )
    .groupBy('suppliers.id', 'suppliers.name')
    .orderBy(sort.field, sort.order);

  applyFilters(qb, filters, client);
  applyCatalogFilters(qb, catalogFilters);

  const rows = await qb;

  return rows.map((r: any) => ({
    supplierId: r.supplier_id,
    supplierName: r.supplier_name,
    productsCount: num(r.products_count),
    receiptsCount: num(r.receipts_count),
    totalAmount: num(r.total_amount),
    totalCashback: num(r.total_cashback),
  }));
}
