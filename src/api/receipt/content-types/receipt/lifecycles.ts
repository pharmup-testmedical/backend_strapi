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

  // Запись удаляется до срабатывания afterDelete, поэтому владельца
  // нужно запомнить заранее в beforeDelete через event.state — иначе
  // удаление подтверждённого чека в админке не пересчитает баланс.
  async beforeDelete(event: any) {
    const { where } = event.params;
    const record = await strapi.db.query('api::receipt.receipt').findOne({
      where,
      populate: ['user'],
    });
    event.state = { userDocumentId: record?.user?.documentId };
  },

  async afterDelete(event: any) {
    const userDocumentId = event.state?.userDocumentId;
    if (userDocumentId) {
      await updateUserBalance(userDocumentId);
    }
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