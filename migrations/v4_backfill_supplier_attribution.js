/**
 * Бэкфилл атрибуции кешбэка к поставщику (модель депозита — этап 1,
 * только разметка данных, ничего не списывает и не блокирует):
 *
 * 1. Product.cashbackSupplier = единственный существующий поставщик, для
 *    всех cashback-eligible товаров, у которых это поле ещё не задано.
 * 2. receipt-item.item.fundingSupplier = тот же поставщик, для всех
 *    существующих позиций чеков с заявленным товаром (claimedProduct),
 *    у которых fundingSupplier ещё не задан.
 *
 * Требует, чтобы в базе был РОВНО один Supplier — если их 0 или больше 1,
 * миграция бросает ошибку и НЕ применяется (не гадает, какой из них
 * "текущий"). При появлении второго реального поставщика этот файл уже не
 * актуален — дальше атрибуция делается вручную через Product.cashbackSupplier
 * на каждом товаре отдельно.
 *
 * Пункт 2 пишет напрямую в БД через knex (strapi.db.connection), а не через
 * strapi.documents().update() — по той же причине, что и в
 * v3_backfill_organization_city.js: Receipt.afterUpdate пересчитывает баланс
 * пользователя при КАЖДОМ сохранении чека; обновление по одному чеку через
 * Document Service дало бы на пользователя с N чеками N пересчётов баланса
 * по N чеков каждый — O(N²), это уже роняло прод на похожем бэкфилле.
 * fundingSupplier — техническое поле, не влияет на баланс, поэтому запись в
 * обход lifecycle-хуков безопасна.
 *
 * Идемпотентно — обрабатывает только записи, где поле ещё не задано, можно
 * запускать повторно (например, если добавили товаров/чеков и хотите
 * доразметить старые, ещё не тронутые бэкфиллом версии 2, до появления
 * второго поставщика).
 */
module.exports = async () => {
  const knex = strapi.db.connection;

  strapi.log.info('🚀 Бэкфилл атрибуции кешбэка к поставщику: старт');

  const suppliers = await strapi.db.query('api::supplier.supplier').findMany({ select: ['id', 'name'] });
  if (suppliers.length !== 1) {
    const names = suppliers.map((s) => `${s.name} (id=${s.id})`).join(', ');
    throw new Error(
      `Бэкфилл атрибуции остановлен: ожидался ровно 1 поставщик в базе, найдено ${suppliers.length}` +
        (names ? ` [${names}]` : '') +
        '. Атрибуцию нужно проставить вручную через Product.cashbackSupplier на каждом товаре.'
    );
  }
  const supplierId = suppliers[0].id;
  strapi.log.info(`📦 Единственный поставщик: "${suppliers[0].name}" (id=${supplierId})`);

  // ==================== 1. Product.cashbackSupplier ====================

  const productsWithoutSupplier = await knex('products as p')
    .leftJoin('products_cashback_supplier_lnk as l', 'l.product_id', 'p.id')
    .whereNull('l.product_id')
    .where('p.cashback_eligible', true)
    .select('p.id');

  strapi.log.info(`📊 Товаров без cashbackSupplier: ${productsWithoutSupplier.length}`);

  if (productsWithoutSupplier.length > 0) {
    const rows = productsWithoutSupplier.map((p) => ({ product_id: p.id, supplier_id: supplierId }));
    await knex.batchInsert('products_cashback_supplier_lnk', rows, 500);
  }
  strapi.log.info(`✅ Проставлен cashbackSupplier на ${productsWithoutSupplier.length} товар(ах)`);

  // ==================== 2. receipt-item.item.fundingSupplier ====================

  // .distinct() обязателен: claimedProduct — oneToOne, но связь ставится по
  // documentId (см. receipt.ts) и Product использует draftAndPublish — если
  // у заявленного товара есть и черновик, и опубликованная версия (два
  // разных числовых id с одним document_id), claimed_product_lnk может
  // содержать по позиции чека ДВЕ строки (на обе версии), иначе INSERT ниже
  // падает на уникальном индексе (item_id, supplier_id). Подтверждено на
  // реальных локальных данных.
  const itemsWithoutFunding = await knex('receipts_cmps as rc')
    .join('components_receipt_item_items_claimed_product_lnk as cpl', 'cpl.item_id', 'rc.cmp_id')
    .leftJoin('components_receipt_item_items_funding_supplier_lnk as fsl', 'fsl.item_id', 'rc.cmp_id')
    .where('rc.field', 'items')
    .where('rc.component_type', 'receipt-item.item')
    .whereNull('fsl.item_id')
    .distinct('rc.cmp_id');

  strapi.log.info(`📊 Позиций чеков без fundingSupplier: ${itemsWithoutFunding.length}`);

  if (itemsWithoutFunding.length > 0) {
    const rows = itemsWithoutFunding.map((r) => ({ item_id: r.cmp_id, supplier_id: supplierId }));
    await knex.batchInsert('components_receipt_item_items_funding_supplier_lnk', rows, 500);
  }
  strapi.log.info(`✅ Проставлен fundingSupplier на ${itemsWithoutFunding.length} позици(ях)`);

  strapi.log.info('🏁 Бэкфилл атрибуции кешбэка к поставщику: готово');
};
