/**
 * Косметика после переименования поля completed-external-task.status →
 * reviewStatus (2026-11-20, фикс "Validation error: Invalid status" —
 * имя "status" зарезервировано Strapi 5 Content Manager под системный
 * draft/published-статус документа и конфликтует с ЛЮБЫМ контент-тайпом,
 * у которого есть атрибут с этим именем, независимо от draftAndPublish).
 *
 * Сама колонка в БД переименовывается ВРУЧНУЮ через SQL (RENAME COLUMN)
 * администратором ДО перезапуска приложения — так безопасно для данных
 * (проверено на локальной копии: если положиться на авто-синхронизацию
 * схемы Strapi при обычном переименовании атрибута в schema.json, она
 * дропает старую колонку ДО того, как успевает выполниться любая миграция
 * в bootstrap()). Эта миграция НЕ трогает данные заявок.
 *
 * Структуру конфигурации Content Manager (metadatas/layouts) Strapi
 * чинит САМ при старте — старый ключ "status" пропадает, "reviewStatus"
 * появляется автоматически, просто с ТЕХНИЧЕСКОЙ подписью (= имя поля).
 * Эта миграция правит только текст подписи на "Статус проверки"
 * (проверено эмпирически на локальной копии: без миграции поле
 * показывается под подписью "reviewStatus").
 *
 * Идемпотентно: если подпись уже "Статус проверки" — пропускает запись.
 *
 * HOTFIX (как v5/v6): если функция не бросает исключение, плагин считает
 * миграцию применённой независимо от исхода внутри try — при ошибке это
 * НЕ повторится автоматически на следующем перезапуске, нужно поправить
 * подпись вручную через Content Manager → Настроить вид.
 */
module.exports = async () => {
    strapi.log.info('🚀 Обновление подписи поля reviewStatus в Content Manager: старт')

    try {
        const knex = strapi.db.connection
        const key = 'plugin_content_manager_configuration_content_types::api::completed-external-task.completed-external-task'
        const label = 'Статус проверки'

        const row = await knex('strapi_core_store_settings').where({ key }).first()
        if (!row) {
            strapi.log.info('ℹ️  Конфигурация Content Manager для completed-external-task ещё не создана — нечего обновлять')
            strapi.log.info('🏁 Обновление подписи reviewStatus: готово')
            return
        }

        const config = typeof row.value === 'string' ? JSON.parse(row.value) : row.value
        const reviewStatusMeta = config?.metadatas?.reviewStatus

        if (!reviewStatusMeta) {
            strapi.log.warn('⚠️  metadatas.reviewStatus отсутствует (неожиданно) — пропуск, поправить вручную через Content Manager → Настроить вид')
            strapi.log.info('🏁 Обновление подписи reviewStatus: готово')
            return
        }

        if (reviewStatusMeta.edit?.label === label && reviewStatusMeta.list?.label === label) {
            strapi.log.info('ℹ️  Подпись уже "Статус проверки" — пропуск (идемпотентно)')
            strapi.log.info('🏁 Обновление подписи reviewStatus: готово')
            return
        }

        reviewStatusMeta.edit = { ...reviewStatusMeta.edit, label }
        reviewStatusMeta.list = { ...reviewStatusMeta.list, label }

        await knex('strapi_core_store_settings').where({ key }).update({ value: JSON.stringify(config) })

        strapi.log.info('✅ Подпись поля reviewStatus обновлена на "Статус проверки"')
        strapi.log.info('🏁 Обновление подписи reviewStatus: готово')
    } catch (error) {
        strapi.log.error(
            `❌ Обновление подписи reviewStatus провалилось (приложение продолжает запуск, поле просто покажется с технической подписью): ${error.message}`,
            { stack: error.stack }
        )
    }
}
