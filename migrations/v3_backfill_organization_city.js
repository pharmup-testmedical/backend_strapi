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
 */
module.exports = async () => {
    const { resolveOrganizationCity } = require('../dist/src/utils/resolve-organization-city')

    strapi.log.info('🚀 Backfill organizationCity: старт')

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
                const { organizationCity, citySource } = await resolveOrganizationCity(
                    strapi,
                    receipt.organizationAddress
                )

                await strapi.documents('api::receipt.receipt').update({
                    documentId: receipt.documentId,
                    data: { organizationCity, citySource },
                })

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
