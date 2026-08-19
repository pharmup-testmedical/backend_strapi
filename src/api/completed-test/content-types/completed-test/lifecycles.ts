import { updateUserBalance } from '../../../../utils/calculate-user-balance';

const syncBalance = async (documentId: string) => {
    const fullCompletedTest = await strapi.documents('api::completed-test.completed-test').findOne({
        documentId,
        populate: ['user']
    });

    if (fullCompletedTest?.user?.documentId) {
        strapi.log.info(`[CompletedTest] Updating balance for user ${fullCompletedTest.user.documentId} after test completion with cashback ${fullCompletedTest.cashback}`);
        await updateUserBalance(fullCompletedTest.user.documentId);
    }
};

export default {
    async afterCreate(event) {
        await syncBalance(event.result.documentId);
    },

    async afterUpdate(event) {
        await syncBalance(event.result.documentId);
    },

    // Запись удаляется до срабатывания afterDelete, поэтому владельца
    // нужно запомнить заранее в beforeDelete через event.state — иначе
    // ручное удаление теста в админке не пересчитает баланс.
    async beforeDelete(event: any) {
        const { where } = event.params;
        const record = await strapi.db.query('api::completed-test.completed-test').findOne({
            where,
            populate: ['user']
        });
        event.state = { userDocumentId: record?.user?.documentId };
    },

    async afterDelete(event: any) {
        const userDocumentId = event.state?.userDocumentId;
        if (userDocumentId) {
            await updateUserBalance(userDocumentId);
        }
    }
};