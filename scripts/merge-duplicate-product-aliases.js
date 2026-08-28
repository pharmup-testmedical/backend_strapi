/**
 * Схлопывание скрытых дублей product-alias (одинаковый товар + одинаковый
 * normalizeAliasName() текст), найденных сканированием реального экспорта
 * от 2026-08-27 (см. отчёт в переписке).
 *
 * НЕ является Strapi-миграцией (не в migrations/, не запустится
 * автоматически). Подготовлен на проверку, для запуска — сознательный
 * отдельный шаг после согласования списка ниже.
 *
 * Логика на группу дублей: оставить самую старую запись (по createdAt),
 * у остальных — перепривязать все receipt-item.item.productAlias,
 * ссылающиеся на удаляемый alias, на оставляемый, затем удалить дубль.
 * Конфликтов verificationStatus внутри найденных групп нет (проверено
 * сканированием) — правило "оставить verified" не потребовалось, во всех
 * группах статус либо одинаково verified, либо одинаково unverified.
 */
module.exports = async function mergeDuplicateProductAliases({ dryRun = true, groups: groupsOverride } = {}) {
  // documentId дублей, найденных сканированием реального экспорта.
  // Формат: [ keepDocumentId, [removeDocumentId, ...] ]
  // Сгенерировано программно из экспорта pa.csv (сортировка по createdAt,
  // keep = самая старая запись в группе) — не транскрибировано вручную.
  const GROUPS = [
    ['i2o3huq3n7m17fq3o8itl9ir', ['qbvyddqj91y4z9rc7sq3luho']], // Глюкометр Fora Comfort Plus G30a (id=119 keep, id=120 remove) — race
    ['upw4gvx4ezf5zli0ptzfh6vz', ['b30rcnewsfh03sly9m9rrq3u']], // Ингалятор Life Neb бренда Life Cor (id=261 keep, id=300 remove)
    ['dw754du5qp6cwfc2z3sroq17', ['ctl0eas1dcr0gegh9i9x3n4a']], // Струйный экспресс-тест №2 (id=255 keep, id=298 remove)
    ['h1usqm4jpliz44zl3oth795m', ['iduckd9q84w7rsszhbttbejx', 'rrwkrwh1pla16kpitt3yr6hv']], // Струйный экспресс-тест №2 (id=147 keep, id=176,188 remove)
    ['mjfm9trhap8lsb8c0tkof4ej', ['n2qjwq1rrajjew2a2tp5u6p6']], // Струйный экспресс-тест №1 (id=226 keep, id=294 remove)
    ['lb86x736f3xfhzimgimozp7m', ['pa56gt9gxunkalqjzkyrozmc']], // Тест-экспресс берем N1 (id=250 keep, id=348 remove)
    ['b4bszghmrvmw296wqwm7cpu3', ['vmzaghd5ms3pzhldowa6w5gr', 'gxbj0ehyqlnlcia2dkhgbec7']], // Экспресс-тест №2 (id=230 keep, id=234,292 remove)
    ['gj7xqvpkp1buxxfecnq3yis3', ['rmr0b32zsktb9j3awiypor15']], // Экспресс-тест №2 (id=83 keep, id=201 remove)
    ['slrhozboctpe3o3o07hnaov5', ['tkdq1xnq5j6tlde2rta1x5uu']], // Термометр LC-203 (id=227 keep, id=308 remove)
    ['en85wge1tboftetn8csqh1ws', ['qgtkpeo4urm8hcfhhm759j1c']], // Термометр LC-112 (id=163 keep, id=274 remove)
    ['uzcccksahrj8vws1k2yh1t65', ['cloqb7rjd9ja38xoonkvma4w']], // Чулки 489 размер 4 (id=165 keep, id=347 remove)
    ['dsuhufh82djdbwaqevs8un9t', ['ncrczxqbl5zw108pepa9tu5x']], // Чулки 489 размер 5 (id=195 keep, id=324 remove)
    ['yb3y85wqbdayebkm6y9td6yj', ['cyy6qjuouyc4l8vyou4qbsm2']], // Чулки 836 (id=275 keep, id=309 remove)
    ['m5flt11w64k3l6ix5zhckq5x', ['wvc00brf4jrovz8w5qk5nwom']], // Экспресс-тест №1 мягк (id=229 keep, id=299 remove)
    ['glaahwzli4rv03e4tfcyuunw', ['ug0cbf8azskgpgp8t1wks4pp']], // Экспресс-тест №1 тверд (id=228 keep, id=289 remove)
    ['qzd4ipzobkm2cli5vtlxj0ia', ['kmjmhfbq1zhwjeixdth814hq']], // Бандаж L (id=247 keep, id=293 remove)
    ['p0t12vkvlpnty6terevjd56l', ['v0avd409et3m86lcl5xtgpgm']], // Бандаж M, REMED-вариант (id=225 keep, id=296 remove)
    ['oudzfdjuf74mytckwuedbm34', ['ogqx8dux8dr5fzapy0edmbd5']], // Бандаж S (id=253 keep, id=312 remove)
    ['bn4l02uv39bywos3zh7c86az', ['rupjtk49zmug9bnnf1sjdzub']], // Бандаж M, короткий вариант (id=182 keep, id=223 remove)
  ];

  const results = [];

  for (const [keepDocumentId, removeDocumentIds] of groupsOverride || GROUPS) {
    const keep = await strapi.documents('api::product-alias.product-alias').findOne({
      documentId: keepDocumentId,
    });
    if (!keep) {
      results.push({ keepDocumentId, error: 'оставляемая запись не найдена — пропуск группы' });
      continue;
    }

    for (const removeDocumentId of removeDocumentIds) {
      const remove = await strapi.documents('api::product-alias.product-alias').findOne({
        documentId: removeDocumentId,
      });
      if (!remove) {
        results.push({ keepDocumentId, removeDocumentId, error: 'удаляемая запись не найдена — пропуск' });
        continue;
      }

      // items — dynamiczone (product-claim | item), глубокая фильтрация по
      // вложенному relation внутри dynamiczone ненадёжна/не поддерживается —
      // забираем чеки целиком и сверяем productAlias в JS.
      const allReceipts = await strapi.documents('api::receipt.receipt').findMany({
        populate: { items: { on: { 'receipt-item.item': { populate: ['productAlias'] } } } },
      });
      const referencingReceipts = allReceipts.filter((r) =>
        (r.items || []).some(
          (item) => item.__component === 'receipt-item.item' && item.productAlias?.documentId === removeDocumentId
        )
      );

      const relinkedReceiptIds = [];
      for (const receipt of referencingReceipts) {
        let changed = false;
        const newItems = (receipt.items || []).map((item) => {
          if (item.__component === 'receipt-item.item' && item.productAlias?.documentId === removeDocumentId) {
            changed = true;
            return { ...item, productAlias: { documentId: keep.documentId } };
          }
          return item;
        });
        if (changed) {
          relinkedReceiptIds.push(receipt.documentId);
          if (!dryRun) {
            await strapi.documents('api::receipt.receipt').update({
              documentId: receipt.documentId,
              data: { items: newItems },
            });
          }
        }
      }

      if (!dryRun) {
        await strapi.documents('api::product-alias.product-alias').delete({ documentId: removeDocumentId });
      }

      results.push({
        keepDocumentId,
        removeDocumentId,
        relinkedReceiptIds,
        action: dryRun ? 'DRY RUN — ничего не изменено' : 'удалено, ссылки перепривязаны',
      });
    }
  }

  return results;
};
