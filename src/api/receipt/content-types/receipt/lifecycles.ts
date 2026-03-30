import { verifiedStatuses } from '../../../../utils/update-scan-task-progress/verified-statuses';
import { updateUserBalance } from '../../../../utils/calculate-user-balance';
import { checkReferralInvitationTask } from '../../../../utils/check-referral-invitation-task';
import { updateScanFirstReceiptsTaskProgress } from '../../../../utils/update-scan-task-progress';

export default {
  async afterCreate(event: any) {
    const { result } = event;
    await handleReceiptLifecycle(result);
  },

  async afterUpdate(event: any) {
    const { result } = event;
    await handleReceiptLifecycle(result);
  },
};

async function handleReceiptLifecycle(result: any) {
  const fullReceipt = await strapi.documents('api::receipt.receipt').findOne({
    documentId: result.documentId,
    populate: ['user'],
  });

  if (!fullReceipt?.user?.documentId) {
    strapi.log.error(`[LIFECYCLE] No user for receipt ${result.documentId}`);
    return;
  }

  const userId = fullReceipt.user.documentId;

  // Fixed: Type-safe check
  const isVerified = verifiedStatuses.includes(
    fullReceipt.verificationStatus as any
  );

  if (isVerified) {
    await checkReferralInvitationTask(userId);
  }

  if (result?.countsForScanTask) {
    await updateScanFirstReceiptsTaskProgress(
      userId,
      fullReceipt.id || fullReceipt.documentId
    );
  }

  await updateUserBalance(userId);
}