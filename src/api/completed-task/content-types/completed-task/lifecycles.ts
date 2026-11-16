import { errors } from '@strapi/utils'
import { updateUserBalance } from '../../../../utils/calculate-user-balance'
import { createNotification } from '../../../../utils/create-notification'
import { formatCurrency } from '../../../../utils/format-currency'

// Задание влияет на account пользователя (см. calculateUserBalance),
// поэтому любое изменение записи — не только её создание — должно
// пересчитывать баланс. Раньше здесь не было lifecycle вообще: ручное
// удаление/правка задания в админке никак не отражалась на балансе.
const syncBalance = async (documentId: string) => {
    const record = await strapi.documents('api::completed-task.completed-task').findOne({
        documentId,
        populate: ['user']
    })

    if (record?.user?.documentId) {
        await updateUserBalance(record.user.documentId)
    }
}

const TASK_LABELS: Record<string, string> = {
    sendInvitations: 'приглашение коллег',
    leaveRating: 'оценку приложения',
    scanFirstReceipts: 'сканирование первых чеков',
    businessAwardsVoting: 'участие в голосовании Business Awards',
}

// Та же форма связи, что уже проверена эмпирически в product-alias/lifecycles.ts:
// реальный Content Manager шлёт { connect: [...] } даже при первом назначении
// связи на новой записи, собственные скрипты — { set: [...] }.
function resolveUserRelationIds(data: any): number[] {
    const rel = data?.user
    if (!rel) return []
    const entries: Array<{ id?: number }> = Array.isArray(rel.set)
        ? rel.set
        : Array.isArray(rel.connect)
            ? rel.connect
            : typeof rel === 'number'
                ? [{ id: rel }]
                : []
    return entries.map((e) => e?.id).filter((id): id is number => typeof id === 'number')
}

// businessAwardsVoting начисляется вручную админом после проверки скрина в
// Telegram-поддержке (см. Трек 1) — без этой проверки повторное создание
// записи тому же пользователю (например, по ошибке) начислит бонус второй раз.
async function assertNoDuplicateBusinessAwardsVoting(data: any) {
    if (data?.task !== 'businessAwardsVoting') return

    const userIds = resolveUserRelationIds(data)
    if (userIds.length === 0) return

    const existing = await strapi.db.query('api::completed-task.completed-task').findOne({
        where: { task: 'businessAwardsVoting', user: { id: { $in: userIds } } },
        populate: ['user'],
    })

    if (existing) {
        throw new errors.ValidationError(
            `Этому пользователю уже начислен бонус за голосование Business Awards (запись ID ${existing.id}). Повторное начисление не допускается.`
        )
    }
}

export default {
    async beforeCreate(event: any) {
        const { data } = event.params || {}
        await assertNoDuplicateBusinessAwardsVoting(data)
    },

    // Уведомление только здесь, в afterCreate — повторное выполнение того
    // же задания уже блокируется выше по стеку (проверка existingCompletion
    // в receipt-контроллере для submitForTask), так что дублей на afterUpdate
    // можно не опасаться отдельной логикой.
    async afterCreate(event: any) {
        await syncBalance(event.result.documentId)

        const record = await strapi.documents('api::completed-task.completed-task').findOne({
            documentId: event.result.documentId,
            populate: ['user'],
        })
        if (record?.user?.documentId && record.cashback > 0) {
            await createNotification({
                userDocumentId: record.user.documentId,
                type: 'cashback',
                title: 'Начислен бонус',
                body: `Начислен бонус ${formatCurrency(record.cashback)} за ${TASK_LABELS[record.task] || 'выполненное задание'}`,
                action: 'cashback_history',
                entityId: record.documentId,
            })
        }
    },

    // Если задание в админке переносят на другого пользователя (user),
    // пересчёта баланса нового владельца недостаточно — у прежнего баланс
    // останется завышенным на кэшбэк этого задания. Запоминаем прежнего
    // владельца заранее, чтобы пересчитать и его тоже.
    async beforeUpdate(event: any) {
        const { where } = event.params
        const record = await strapi.db.query('api::completed-task.completed-task').findOne({
            where,
            populate: ['user']
        })
        event.state = { previousUserDocumentId: record?.user?.documentId }
    },

    async afterUpdate(event: any) {
        await syncBalance(event.result.documentId)

        const previousUserDocumentId = event.state?.previousUserDocumentId
        const fullRecord = await strapi.documents('api::completed-task.completed-task').findOne({
            documentId: event.result.documentId,
            populate: ['user']
        })
        if (previousUserDocumentId && previousUserDocumentId !== fullRecord?.user?.documentId) {
            await updateUserBalance(previousUserDocumentId)
        }
    },

    // Запись удаляется до срабатывания afterDelete, поэтому нужно
    // заранее запомнить владельца в beforeDelete через event.state.
    async beforeDelete(event: any) {
        const { where } = event.params
        const record = await strapi.db.query('api::completed-task.completed-task').findOne({
            where,
            populate: ['user']
        })
        event.state = { userDocumentId: record?.user?.documentId }
    },

    async afterDelete(event: any) {
        const userDocumentId = event.state?.userDocumentId
        if (userDocumentId) {
            await updateUserBalance(userDocumentId)
        }
    }
}
