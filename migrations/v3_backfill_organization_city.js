/**
 * Backfill organizationCity/citySource для уже существующих чеков.
 *
 * Использует УЖЕ сохранённый receipt.organizationAddress — никаких повторных
 * запросов к ОФД. Переиспользует существующий deriveCityAndAddress()
 * (src/utils/kz-city-clusters.ts) и существующий справочник api::city.city —
 * ничего нового не парсит и не создаёт.
 *
 * Идемпотентно: обрабатывает только чеки с organizationCity = null, поэтому
 * безопасно запускать повторно (например, после доработки парсера) — уже
 * определённые как 'organization' чеки не трогает.
 *
 * ВАЖНО: пишет напрямую в БД через knex (strapi.db.connection), А НЕ через
 * strapi.documents().update(). Это сознательно — в проекте уже есть
 * Receipt.afterUpdate хук (не связан с этой миграцией), который на КАЖДОЕ
 * сохранение чека пересчитывает весь баланс пользователя (проходит по всем
 * его чекам заново). При обновлении по одному чеку за раз через обычный
 * update() у пользователя с N чеками это давало N пересчётов баланса по N
 * чеков каждый — O(N²), что на реальном объёме забивало сервер и роняло
 * его в 504 (обнаружено и подтверждено по логам на проде). Прямая запись в
 * БД физически не проходит через lifecycle-хуки Document Service, поэтому
 * пересчёт баланса не запускается вообще — это чисто техническое поле,
 * балансу чека оно не касается.
 */
module.exports = async () => {
    const { deriveCityAndAddress } = require('../dist/src/utils/kz-city-clusters')

    strapi.log.info('🚀 Backfill organizationCity: старт')

    const knex = strapi.db.connection

    const receipts = await strapi.db.query('api::receipt.receipt').findMany({
        where: { organizationCity: null },
        select: ['id', 'documentId', 'organizationAddress'],
    })

    strapi.log.info(`📊 Найдено ${receipts.length} чеков без organizationCity`)

    let resolvedCount = 0
    let unknownCount = 0
    let errorCount = 0

    const batchSize = 100
    for (let i = 0; i < receipts.length; i += batchSize) {
        const batch = receipts.slice(i, i + batchSize)
        strapi.log.info(`🔄 Батч ${Math.floor(i / batchSize) + 1}/${Math.ceil(receipts.length / batchSize)}`)

        for (const receipt of batch) {
            try {
                const { city } = deriveCityAndAddress(receipt.organizationAddress)

                let cityId = null
                if (city) {
                    const cityRow = await knex('cities').select('id').where({ name: city }).first()
                    cityId = cityRow?.id ?? null
                    if (!cityId) {
                        strapi.log.warn(`[organizationCity] Город "${city}" распознан из адреса, но отсутствует в справочнике api::city.city`)
                    }
                }
                const citySource = cityId ? 'organization' : 'unknown'

                await knex('receipts').where({ id: receipt.id }).update({ city_source: citySource })
                await knex('receipts_organization_city_lnk').where({ receipt_id: receipt.id }).delete()
                if (cityId) {
                    await knex('receipts_organization_city_lnk').insert({ receipt_id: receipt.id, city_id: cityId })
                }

                if (citySource === 'organization') {
                    resolvedCount++
                } else {
                    unknownCount++
                }
            } catch (error) {
                errorCount++
                strapi.log.error(`❌ Чек ${receipt.documentId}: ${error.message}`)
            }
        }
    }

    strapi.log.info('\n📋 Backfill organizationCity — итог:')
    strapi.log.info(`   ✅ Город определён: ${resolvedCount}`)
    strapi.log.info(`   ❔ Город не определён (unknown): ${unknownCount}`)
    strapi.log.info(`   ❌ Ошибок: ${errorCount}`)
    strapi.log.info(`   Всего обработано: ${receipts.length}`)
}
