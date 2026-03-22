import { updateUserBalance, checkAndCompleteTasks } from '../../../../utils/calculate-user-balance';
import { checkReferralInvitationTask } from '../../../../utils/check-referral-invitation-task';

export default {
    async afterCreate(event) {
        const { result } = event;
        const fullReceipt = await strapi.documents('api::receipt.receipt').findOne({
            documentId: result.documentId,
            populate: ['user']
        });

        if (fullReceipt?.user?.documentId) {
            // Check if receipt is verified
            const verifiedStatuses = [
                'auto_verified',
                'manually_verified',
                'auto_partially_verified',
                'manually_partially_verified'
            ];

            const isVerified = verifiedStatuses.includes(fullReceipt.verificationStatus);

            if (isVerified) {
                // Check if this receipt triggers referral task for the inviter
                await checkReferralInvitationTask(fullReceipt.user.documentId);
            }

            await updateUserBalance(fullReceipt.user.documentId);
            await checkAndCompleteTasks(fullReceipt.user.documentId);
        }
    },

    async afterUpdate(event) {
        const { result } = event;
        const fullReceipt = await strapi.documents('api::receipt.receipt').findOne({
            documentId: result.documentId,
            populate: ['user']
        });

        if (fullReceipt?.user?.documentId) {
            // Check if verification status changed to a verified state
            const verifiedStatuses = [
                'auto_verified',
                'manually_verified',
                'auto_partially_verified',
                'manually_partially_verified'
            ];

            const isVerified = verifiedStatuses.includes(fullReceipt.verificationStatus);

            if (isVerified) {
                // Check if this receipt triggers referral task for the inviter
                await checkReferralInvitationTask(fullReceipt.user.documentId);
            }

            await updateUserBalance(fullReceipt.user.documentId);
            await checkAndCompleteTasks(fullReceipt.user.documentId);
        }
    }
};