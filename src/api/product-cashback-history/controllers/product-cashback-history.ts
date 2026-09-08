/**
 * product-cashback-history controller
 */

import { factories } from '@strapi/strapi';

const EPSILON = 0.01;

export default factories.createCoreController(
  'api::product-cashback-history.product-cashback-history',
  ({ strapi }) => ({
    // Одноразовый бэкфилл: сканирует ВСЕ чеки, находит позиции, чья ставка
    // кешбэка отличается от текущей ставки карточки товара, и записывает эту
    // старую ставку как легитимный исторический период (validFrom=null —
    // точная дата начала неизвестна, validTo=время запуска бэкфилла — с этого
    // момента она точно уже не действует, т.к. в карточке товара сейчас
    // другое значение). Для каждого затронутого товара дополнительно создаёт
    // «текущий» открытый период (validTo=null), если такого ещё нет — чтобы
    // hook в product/lifecycles.ts впоследствии корректно его закрыл при
    // следующем изменении ставки.
    //
    // Идемпотентен: повторный запуск не создаёт дублей (сверяется с уже
    // существующими записями истории), можно запускать сколько угодно раз.
    // Тот же секрет, что уже настроен на Plesk для бэкфилла Google Sheets
    // (SHEET_BACKFILL_SECRET) — отдельная переменная ради этого разового
    // действия не нужна.
    async backfill(ctx: any) {
      const providedSecret = (ctx.request.headers['x-backfill-secret'] || '').trim();
      const expectedSecret = (process.env.SHEET_BACKFILL_SECRET || '').trim();
      if (!expectedSecret || providedSecret !== expectedSecret) {
        strapi.log.warn(
          `[CashbackHistoryBackfill] Секрет не совпал: env задан=${!!expectedSecret} (длина ${expectedSecret.length}), в заголовке длина ${providedSecret.length}`
        );
        return ctx.forbidden('Неверный или не заданный секрет');
      }

      try {
        const products = (await strapi.db.query('api::product.product').findMany({
          select: ['id', 'cashbackAmount'],
        })) as Array<{ id: number; cashbackAmount: number }>;
        const currentRateByProductId = new Map<number, number>();
        for (const p of products) currentRateByProductId.set(p.id, Number(p.cashbackAmount));

        const existingHistory = (await strapi.db
          .query('api::product-cashback-history.product-cashback-history')
          .findMany({
            select: ['rate', 'validTo'],
            populate: { product: { select: ['id'] } },
          })) as Array<{ rate: number; validTo: string | null; product: { id: number } | null }>;

        const existingByProductId = new Map<number, { rates: Set<number>; hasOpenPeriod: boolean }>();
        const rateKey = (rate: number) => Math.round(rate * 100);
        for (const h of existingHistory) {
          const pid = h.product?.id;
          if (pid == null) continue;
          const entry = existingByProductId.get(pid) ?? { rates: new Set<number>(), hasOpenPeriod: false };
          entry.rates.add(rateKey(Number(h.rate)));
          if (h.validTo == null) entry.hasOpenPeriod = true;
          existingByProductId.set(pid, entry);
        }

        const oldRatesByProductId = new Map<number, Set<number>>();
        const pageSize = 500;
        let start = 0;
        let scannedReceipts = 0;

        while (true) {
          const receipts = (await strapi.documents('api::receipt.receipt').findMany({
            start,
            limit: pageSize,
            sort: ['id:asc'],
            fields: ['id'],
            populate: {
              items: {
                on: {
                  'receipt-item.item': {
                    fields: ['cashback'],
                    populate: { claimedProduct: { fields: ['id'] } },
                  },
                },
              },
            },
          })) as any[];

          if (receipts.length === 0) break;

          for (const receipt of receipts) {
            for (const item of receipt.items ?? []) {
              if (item.__component !== 'receipt-item.item') continue;
              const productId = item.claimedProduct?.id;
              if (productId == null) continue;
              const currentRate = currentRateByProductId.get(productId);
              if (currentRate == null) continue;
              const itemRate = Number(item.cashback);
              if (!Number.isFinite(itemRate) || Math.abs(itemRate - currentRate) <= EPSILON) continue;

              const set = oldRatesByProductId.get(productId) ?? new Set<number>();
              set.add(rateKey(itemRate));
              oldRatesByProductId.set(productId, set);
            }
          }

          scannedReceipts += receipts.length;
          start += pageSize;
        }

        const now = new Date();
        const historyQuery = strapi.db.query('api::product-cashback-history.product-cashback-history');
        let createdOldRateRows = 0;
        let createdCurrentRateRows = 0;
        let affectedProducts = 0;

        for (const [productId, rateKeys] of oldRatesByProductId.entries()) {
          const existing = existingByProductId.get(productId) ?? { rates: new Set<number>(), hasOpenPeriod: false };
          let touched = false;

          for (const key of rateKeys) {
            if (existing.rates.has(key)) continue;
            await historyQuery.create({
              data: { product: productId, rate: key / 100, validFrom: null, validTo: now },
            });
            createdOldRateRows++;
            touched = true;
          }

          if (!existing.hasOpenPeriod) {
            const currentRate = currentRateByProductId.get(productId);
            if (currentRate != null) {
              await historyQuery.create({
                data: { product: productId, rate: currentRate, validFrom: null, validTo: null },
              });
              createdCurrentRateRows++;
              touched = true;
            }
          }

          if (touched) affectedProducts++;
        }

        strapi.log.info(
          `[CashbackHistoryBackfill] Просканировано чеков: ${scannedReceipts}, затронуто товаров: ${affectedProducts}, создано записей старых ставок: ${createdOldRateRows}, текущих: ${createdCurrentRateRows}`
        );

        ctx.body = { scannedReceipts, affectedProducts, createdOldRateRows, createdCurrentRateRows };
      } catch (error: any) {
        strapi.log.error(`[CashbackHistoryBackfill] Ошибка: ${error.message}`);
        ctx.badRequest(error.message);
      }
    },
  })
);
