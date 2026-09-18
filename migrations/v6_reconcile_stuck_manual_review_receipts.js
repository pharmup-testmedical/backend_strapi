/**
 * Самоисцеляющий разбор зависших чеков: находит ЛЮБОЙ чек в manual_review,
 * у которого позиция ссылается на псевдоним, уже переведённый в
 * verified/rejected (не unverified) — то есть ретроактивный sweep в
 * product-alias afterUpdate ДОЛЖЕН был его обработать, но по какой-то
 * причине не дожал — и повторно прогоняет ту же updateReceiptStatus(),
 * которую вызвал бы обычный сценарий "админ подтвердил псевдоним".
 *
 * Зачем отдельной миграцией, а не точечным фиксом под конкретные id:
 * обнаружено минимум 3 живых случая (2026-09-18) одной и той же причины
 * (см. v5_backfill_deposit_field_defaults.js — NULL в депозитных полях на
 * старых позициях ломал yup-валидацию при update(), а цикл в
 * product-alias/lifecycles.ts afterUpdate не имеет try/catch НА ПОЗИЦИЮ
 * цикла — одна проблемная запись обрывала весь проход, включая соседние
 * ни в чём не повинные чеки). ДОЛЖНА запускаться ПОСЛЕ v5 — иначе упадёт
 * на той же ошибке валидации на ещё не забэкфилленных строках.
 *
 * Идёт через strapi.documents()/updateReceiptStatus() (не сырой knex) —
 * это единственный код, который умеет корректно вычислить новый
 * verificationStatus чека и finalCashback (calculateFinalCashback) с
 * учётом quantity — то же самое действие, что делает
 * product-alias/lifecycles.ts afterUpdate в норме, просто с задержкой.
 * Каждый чек — в своём try/catch: одна ещё не найденная проблема НЕ
 * должна блокировать дожим остальных (тот самый недостаток исходного
 * цикла, который сюда специально не переносим).
 *
 * Идемпотентно: чек, который уже вышел из manual_review (в этом самом
 * проходе или раньше), больше не попадёт в выборку при повторном запуске.
 */
module.exports = async () => {
    strapi.log.info('🚀 Разбор зависших чеков (псевдоним уже решён, чек всё ещё manual_review): старт')

    const { updateReceiptStatus } = require('../dist/src/utils/determine-receipt-status')

    const receipts = await strapi.entityService.findMany('api::receipt.receipt', {
        filters: { verificationStatus: 'manual_review' },
        populate: {
            items: {
                on: {
                    'receipt-item.item': {
                        populate: { productAlias: true, props: true },
                    },
                    'receipt-item.product-claim': {},
                },
            },
        },
    })

    const stuckReceipts = receipts.filter((receipt) =>
        receipt.items.some(
            (item) =>
                item.__component === 'receipt-item.item' &&
                item.productAlias &&
                item.productAlias.verificationStatus !== 'unverified'
        )
    )

    strapi.log.info(`📊 Найдено ${stuckReceipts.length} зависших чеков из ${receipts.length} в manual_review`)

    let fixedCount = 0
    let errorCount = 0
    for (const receipt of stuckReceipts) {
        try {
            await updateReceiptStatus(receipt, strapi)
            fixedCount++
        } catch (error) {
            errorCount++
            strapi.log.error(`❌ Чек ${receipt.documentId}: не удалось дожать — ${error.message}`)
        }
    }

    strapi.log.info(`📋 Разбор зависших чеков — итог: дожато ${fixedCount}, ошибок ${errorCount}`)
    strapi.log.info('🏁 Разбор зависших чеков: готово')
}
