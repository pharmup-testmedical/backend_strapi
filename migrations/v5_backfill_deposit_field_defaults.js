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
 */
module.exports = async () => {
    strapi.log.info('🚀 Бэкфилл дефолтов депозитных полей на старых позициях чека: старт')

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
}
