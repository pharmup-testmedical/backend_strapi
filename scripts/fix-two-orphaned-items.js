/**
 * Точечный фикс для двух конкретных "осиротевших" текстов позиций чека
 * (заданы вручную по запросу пользователя, псевдонимы под них уже созданы
 * им самим в админке). Для каждой позиции, где текст совпадает по
 * normalizeAliasName() с одним из двух целевых, и productAlias пуст:
 *  - находит СУЩЕСТВУЮЩИЙ псевдоним у заявленного товара (не создаёт новый);
 *  - если нашёлся — привязывает его и заменяет name позиции на чистый текст
 *    (без лишних пробелов).
 * Если псевдонима не нашлось — ничего не меняет для этой позиции, только
 * логирует (aliasFound:false), чтобы не создавать неожиданных новых записей.
 *
 * НЕ Strapi-миграция. dryRun:true по умолчанию.
 */
module.exports = async function fixTwoOrphanedItems({ dryRun = true } = {}) {
  const { normalizeAliasName } = require('../dist/src/utils/normalize-alias-name');

  const CLEAN_NAMES = [
    'FORA COMFORT ТЕСТ ПОЛОСКИ №50(Уп)',
    'LIFE COR ТЕСТ ДЛЯ ОПРЕДЕЛЕНИЯ БЕРЕМЕННОСТИ №1 В ТВЕРД УПАК(Уп)',
  ];
  const normToClean = new Map(CLEAN_NAMES.map((n) => [normalizeAliasName(n), n]));

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

      const norm = normalizeAliasName(item.name);
      const cleanName = normToClean.get(norm);
      if (!cleanName) {
        newItems.push(item);
        continue;
      }

      const product = await strapi.documents('api::product.product').findOne({
        documentId: item.claimedProduct.documentId,
        status: 'published',
        populate: { productAliases: true },
      });
      const alias = (product?.productAliases || []).find(
        (a) => normalizeAliasName(a.alternativeName) === norm
      );

      results.push({
        receiptId: receipt.documentId,
        oldName: item.name,
        newName: cleanName,
        product: product?.canonicalName ?? null,
        aliasFound: !!alias,
        aliasId: alias?.id ?? null,
      });

      if (alias) {
        changed = true;
        newItems.push(!dryRun ? { ...item, name: cleanName, productAlias: { documentId: alias.documentId } } : item);
      } else {
        newItems.push(item);
      }
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
