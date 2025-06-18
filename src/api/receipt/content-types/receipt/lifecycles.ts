import { updateUserBalance } from '../../../../utils/calculate-user-balance';

export default {
    async afterCreate(event) {
        const { result } = event;
        const fullReceipt = await strapi.documents('api::receipt.receipt').findOne({
            documentId: result.documentId,
            populate: ['user']
        });

        if (fullReceipt.user?.documentId) {
            await updateUserBalance(fullReceipt.user.documentId);
        }
    },

    async afterUpdate(event) {
        const { result } = event;
        const fullReceipt = await strapi.documents('api::receipt.receipt').findOne({
            documentId: result.documentId,
            populate: ['user']
        });

        if (fullReceipt.user?.documentId) {
            await updateUserBalance(fullReceipt.user.documentId);
        }
    }
};