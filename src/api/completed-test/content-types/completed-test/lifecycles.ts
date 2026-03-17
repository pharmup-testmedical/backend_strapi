import { updateUserBalance } from '../../../../utils/calculate-user-balance';

export default {
    async afterCreate(event) {
        const { result } = event;
        const fullCompletedTest = await strapi.documents('api::completed-test.completed-test').findOne({
            documentId: result.documentId,
            populate: ['user']
        });

        if (fullCompletedTest?.user?.documentId) {
            strapi.log.info(`[CompletedTest] Updating balance for user ${fullCompletedTest.user.documentId} after test completion with cashback ${fullCompletedTest.cashback}`);
            await updateUserBalance(fullCompletedTest.user.documentId);
        }
    }
};