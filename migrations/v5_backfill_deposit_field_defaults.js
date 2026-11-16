/**
 * Бэкфилл дефолтов депозитных полей на позициях чека (receipt-item.item),
 * созданных ДО того, как эти поля появились в схеме (депозит поставщика,
 * этап 2, деплой 2026-09-17).
 *
 * Найдено эмпирически 2026-09-18: Strapi при добавлении нового required-поля
 * в схему НЕ backfill'ит существующие строки значением из "default" в
 * schema.json — старые позиции остаются с depositExhausted=NULL,
 * depositDeductedAmount=NULL. Это молча всплывает потом: когда
 * determine-receipt-status.ts (product-alias afterUpdate → ретроактивное
 * обновление чеков при подтверждении псевдонима) перечитывает такую старую
 * позицию и отправляет её ЦЕЛИКОМ обратно на update() — yup validation
 * отклоняет `null` как boolean и `NaN` (Number(null) в арифметике) как
 * number, чек навсегда остаётся в manual_review. Подтверждено на реальных
 * данных (3 живых случая, все — позиции старше вчерашнего деплоя).
 *
 * Прямая запись через knex (strapi.db.connection), не через
 * strapi.documents().update() — та же причина, что и в
 * v3_backfill_organization_city.js: не хотим триггерить lifecycle-хуки
 * чека (пересчёт баланса) на КАЖДУЮ позицию — чисто техническое поле,
 * реального финансового смысла (депозит уже либо был, либо не был списан
 * до появления этих полей — то есть НЕ был, отсюда и false/0 как верный
 * дефолт, не любое другое значение) это не меняет.
 *
 * Идемпотентно — трогает только строки, где поле ещё NULL, безопасно
 * запускать повторно.
 *
 * HOTFIX (как и в v4_backfill_supplier_attribution.js): migration-v5p
 * фатален для старта ВСЕГО Strapi при любой ошибке миграции, не только
 * этой фичи — подтверждено инцидентом 2026-09-17 (2 поставщика). Простые
 * knex-update() здесь низкорисковые, но на случай непредвиденной ошибки
 * БД (блокировка, обрыв соединения) — try/catch, чтобы сайт не падал в
 * crash-loop.
 *
 * ВАЖНО (проверено по исходнику плагина): если функция НЕ бросает
 * исключение, плагин считает миграцию применённой и продвигает версию —
 * даже если внутри try/catch реально ничего не сделал. Поэтому при
 * ошибке это НЕ автоматически повторится на следующем перезапуске,
 * просто сайт не упадёт — если в логе видно "❌ Бэкфилл... провалился",
 * нужно разобраться и выполнить вручную:
 *   UPDATE components_receipt_item_items SET deposit_exhausted = false WHERE deposit_exhausted IS NULL;
 *   UPDATE components_receipt_item_items SET deposit_deducted_amount = 0 WHERE deposit_deducted_amount IS NULL;
 */
module.exports = async () => {
    strapi.log.info('🚀 Бэкфилл дефолтов депозитных полей на старых позициях чека: старт')

    try {
        const knex = strapi.db.connection

        const exhaustedFixed = await knex('components_receipt_item_items')
            .whereNull('deposit_exhausted')
            .update({ deposit_exhausted: false })

        const deductedFixed = await knex('components_receipt_item_items')
            .whereNull('deposit_deducted_amount')
            .update({ deposit_deducted_amount: 0 })

        strapi.log.info(`✅ deposit_exhausted проставлен (false) на ${exhaustedFixed} позиции(ях)`)
        strapi.log.info(`✅ deposit_deducted_amount проставлен (0) на ${deductedFixed} позиции(ях)`)
        strapi.log.info('🏁 Бэкфилл дефолтов депозитных полей: готово')
    } catch (error) {
        strapi.log.error(
            `❌ Бэкфилл дефолтов депозитных полей провалился (приложение продолжает запуск): ${error.message}`,
            { stack: error.stack }
        )
    }
}
