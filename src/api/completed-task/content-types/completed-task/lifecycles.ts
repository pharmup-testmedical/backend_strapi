import { updateUserBalance } from '../../../../utils/calculate-user-balance'

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

export default {
    async afterCreate(event: any) {
        await syncBalance(event.result.documentId)
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
