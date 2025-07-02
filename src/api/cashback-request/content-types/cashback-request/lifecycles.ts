import { updateUserBalance } from '../../../../utils/calculate-user-balance';

export default {
    async afterUpdate(event) {
        console.log(JSON.stringify(event))
        const { result } = event;
        const fullRequest = await strapi.documents('api::cashback-request.cashback-request').findOne({
            documentId: result.documentId,
            populate: ['requester']
        });

        if (fullRequest.requester?.documentId) {
            await updateUserBalance(fullRequest.requester.documentId);
        }
    }
};