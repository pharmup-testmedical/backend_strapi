import { errors } from '@strapi/utils'
import { updateUserBalance } from '../../../../utils/calculate-user-balance'
import { createNotification } from '../../../../utils/create-notification'
import { formatCurrency } from '../../../../utils/format-currency'

// Начисление идемпотентно "бесплатно": calculateUserBalance каждый раз
// заново суммирует rewardAmountAtSubmission только у записей со
// status === 'approved' (см. calculate-user-balance.ts) — это не журнал
// начислений, а пересчёт с нуля от текущего состояния. Поэтому повторное
// сохранение уже approved записи, а также approved → pending → approved,
// не могут начислить бонус второй раз — на любой момент пересчёта он либо
// учтён один раз (status === 'approved'), либо не учтён вовсе.
//
// approved → rejected ЗАПРЕЩЁН ниже (beforeUpdate) — не из-за самого
// механизма пересчёта (он бы корректно вычел сумму на следующем
// пересчёте), а из-за того, что к моменту отклонения бонус мог уже быть
// реально выведен пользователем (вывод обрабатывает администратор
// вручную) — баланс ушёл бы в минус БЕЗ видимого следа в "Истории
// транзакций" (одобренная запись просто исчезла бы из суммы). Решение
// (согласовано): если одобрение оказалось ошибкой, исправлять вручную
// вне этого статуса, а не через автоматическое списание.
const syncBalance = async (documentId: string) => {
    const record = await strapi.documents('api::completed-external-task.completed-external-task').findOne({
        documentId,
        populate: ['user'],
    })
    if (record?.user?.documentId) {
        await updateUserBalance(record.user.documentId)
    }
}

export default {
    async beforeUpdate(event: any) {
        const { where, data } = event.params
        const record = await strapi.db.query('api::completed-external-task.completed-external-task').findOne({
            where,
            populate: ['user'],
        })
        event.state = {
            previousUserDocumentId: record?.user?.documentId,
            previousStatus: record?.status,
        }

        if (record?.status === 'approved' && data?.status === 'rejected') {
            throw new errors.ValidationError(
                'Нельзя отклонить уже одобренное задание — начисление выполнено. Исправление — вручную.'
            )
        }
    },

    async afterUpdate(event: any) {
        await syncBalance(event.result.documentId)

        const fullRecord = await strapi.documents('api::completed-external-task.completed-external-task').findOne({
            documentId: event.result.documentId,
            populate: ['user', 'externalTask'],
        })

        const previousUserDocumentId = event.state?.previousUserDocumentId
        if (previousUserDocumentId && previousUserDocumentId !== fullRecord?.user?.documentId) {
            await updateUserBalance(previousUserDocumentId)
        }

        // Уведомление только на реальном переходе в approved/rejected —
        // повторное сохранение уже решённой заявки не шлёт уведомление
        // заново (тот же паттерн, что в cashback-request/lifecycles.ts).
        const previousStatus = event.state?.previousStatus
        const newStatus = fullRecord?.status
        const isFreshDecision =
            previousStatus !== newStatus && (newStatus === 'approved' || newStatus === 'rejected')

        if (isFreshDecision && fullRecord?.user?.documentId) {
            const taskTitle = fullRecord.externalTask?.title || 'задание'
            const title = newStatus === 'approved' ? 'Начислен бонус' : 'Заявка отклонена'
            const body =
                newStatus === 'approved'
                    ? `Начислен бонус ${formatCurrency(fullRecord.rewardAmountAtSubmission)} за «${taskTitle}»`
                    : `Заявка по заданию «${taskTitle}» отклонена${fullRecord.rejectionReason ? `: ${fullRecord.rejectionReason}` : ''}`

            // Без entityId — 'cashback_history' ведёт на общий экран
            // "Транзакции" (см. notificationNavigation.js). С entityId этот
            // action открывает ReceiptDetail, который ждёт documentId ЧЕКА,
            // а не этой записи — передавать его здесь нельзя.
            await createNotification({
                userDocumentId: fullRecord.user.documentId,
                type: 'cashback',
                title,
                body,
                action: 'cashback_history',
            })
        }
    },

    async beforeDelete(event: any) {
        const { where } = event.params
        const record = await strapi.db.query('api::completed-external-task.completed-external-task').findOne({
            where,
            populate: ['user'],
        })
        event.state = { userDocumentId: record?.user?.documentId }
    },

    async afterDelete(event: any) {
        const userDocumentId = event.state?.userDocumentId
        if (userDocumentId) {
            await updateUserBalance(userDocumentId)
        }
    },
}
