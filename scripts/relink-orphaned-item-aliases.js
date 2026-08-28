/**
 * Релинковка "осиротевших" позиций чека: claimedProduct указан, а
 * productAlias пуст (потерялась связь — например, при ручной чистке
 * дублей удалили обе записи вместо одной, каскадно обнулив ссылку у
 * позиций чеков).
 *
 * Для каждой такой позиции ищет среди ОПУБЛИКОВАННЫХ псевдонимов
 * заявленного товара тот, чей normalizeAliasName() совпадает с названием
 * позиции — тот же принцип сравнения, что и в receipt.ts/lifecycles.ts
 * (регистр/пробелы/гомоглифы не считаются различием). Если нашёлся —
 * привязывает существующий. Если такого псевдонима больше нет вообще —
 * создаёт новый (как findOrCreateAliasByName в receipt.ts) и привязывает.
 *
 * НЕ Strapi-миграция (не в migrations/, не запустится сама). dryRun:true
 * по умолчанию — только показывает, что сделал бы, ничего не меняет.
 */
module.exports = async function relinkOrphanedItemAliases({ dryRun = true, newAliasStatus = 'verified' } = {}) {
  const { normalizeAliasName } = require('../dist/src/utils/normalize-alias-name');

  const receipts = await strapi.documents('api::receipt.receipt').findMany({
    populate: {
      items: {
        on: {
          'receipt-item.item': {
            populate: ['claimedProduct', 'productAlias'],
          },
        },
      },
    },
  });

  const results = [];

  for (const receipt of receipts) {
    let changed = false;
    const newItems = [];

    for (const item of receipt.items || []) {
      if (item.__component !== 'receipt-item.item' || item.productAlias || !item.claimedProduct) {
        newItems.push(item);
        continue;
      }

      const product = await strapi.documents('api::product.product').findOne({
        documentId: item.claimedProduct.documentId,
        status: 'published',
        populate: { productAliases: true },
      });
      if (!product) {
        newItems.push(item);
        continue;
      }

      const targetNorm = normalizeAliasName(item.name);
      let alias = (product.productAliases || []).find(
        (a) => normalizeAliasName(a.alternativeName) === targetNorm
      );
      const action = alias ? 'relink' : 'create+link';

      if (!alias && !dryRun) {
        alias = await strapi.documents('api::product-alias.product-alias').create({
          data: {
            alternativeName: item.name,
            normalizedName: targetNorm,
            verificationStatus: newAliasStatus,
            product: { documentId: product.documentId },
          },
        });
      }

      results.push({
        receiptId: receipt.documentId,
        itemName: item.name,
        product: product.canonicalName,
        action,
        aliasId: alias?.id ?? null,
      });

      changed = true;
      newItems.push(!dryRun && alias ? { ...item, productAlias: { documentId: alias.documentId } } : item);
    }

    if (changed && !dryRun) {
      await strapi.documents('api::receipt.receipt').update({
        documentId: receipt.documentId,
        data: { items: newItems },
      });
    }
  }

  return results;
};
