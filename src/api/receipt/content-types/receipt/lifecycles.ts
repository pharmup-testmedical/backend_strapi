import { verifiedStatuses } from '../../../../utils/update-scan-task-progress/verified-statuses';
import { updateUserBalance } from '../../../../utils/calculate-user-balance';
import { checkReferralInvitationTask } from '../../../../utils/check-referral-invitation-task';
import { updateScanFirstReceiptsTaskProgress } from '../../../../utils/update-scan-task-progress';
import { createNotification } from '../../../../utils/create-notification';
import { formatCurrency } from '../../../../utils/format-currency';

export default {
  async afterCreate(event: any) {
    const { result } = event;
    await handleReceiptLifecycle(result, { previousVerificationStatus: null });
  },

  // Если чек в админке переносят на другого пользователя, обычного
  // пересчёта баланса НОВОГО владельца недостаточно — у ПРЕЖНЕГО владельца
  // баланс останется завышенным на кэшбэк этого чека. Запоминаем прежнего
  // владельца до обновления, чтобы пересчитать и его тоже. Заодно
  // запоминаем прежний verificationStatus — уведомление о начислении
  // кэшбэка должно создаваться только при ПЕРВОМ переходе в подтверждённый
  // статус, а не при каждом повторном сохранении уже подтверждённого чека.
  async beforeUpdate(event: any) {
    const { where } = event.params;
    const record = await strapi.db.query('api::receipt.receipt').findOne({
      where,
      populate: ['user'],
    });
    event.state = {
      previousUserDocumentId: record?.user?.documentId,
      previousVerificationStatus: record?.verificationStatus,
    };
  },

  async afterUpdate(event: any) {
    const { result } = event;
    const currentUserDocumentId = await handleReceiptLifecycle(result, {
      previousVerificationStatus: event.state?.previousVerificationStatus ?? null,
    });

    const previousUserDocumentId = event.state?.previousUserDocumentId;
    if (previousUserDocumentId && previousUserDocumentId !== currentUserDocumentId) {
      await updateUserBalance(previousUserDocumentId);
    }
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

async function handleReceiptLifecycle(
  result: any,
  { previousVerificationStatus }: { previousVerificationStatus: string | null }
) {
  const fullReceipt = await strapi.documents('api::receipt.receipt').findOne({
    documentId: result.documentId,
    populate: ['user'],
  });

  if (!fullReceipt?.user?.documentId) {
    strapi.log.error(`[LIFECYCLE] No user for receipt ${result.documentId}`);
    return undefined;
  }

  const userId = fullReceipt.user.documentId;

  // Fixed: Type-safe check
  const isVerified = verifiedStatuses.includes(
    fullReceipt.verificationStatus as any
  );
  const wasVerified = previousVerificationStatus
    ? verifiedStatuses.includes(previousVerificationStatus as any)
    : false;

  if (isVerified) {
    await checkReferralInvitationTask(userId);

    // Уведомление только при ПЕРВОМ переходе в подтверждённый статус, не
    // при каждом сохранении уже подтверждённого чека (approved -> approved
    // не должно спамить пользователя).
    if (!wasVerified && fullReceipt.finalCashback > 0) {
      // Для чеков, отправленных фото (fiscalId — сгенерированный технический
      // id, не настоящий номер), номер чека в тексте не показываем.
      const body = fullReceipt.submissionMethod === 'photo'
        ? `Вам начислен кэшбэк ${formatCurrency(fullReceipt.finalCashback)}`
        : `Вам начислен кэшбэк ${formatCurrency(fullReceipt.finalCashback)} за чек №${fullReceipt.fiscalId}`;

      await createNotification({
        userDocumentId: userId,
        type: 'cashback',
        title: 'Начислен кэшбэк',
        body,
        action: 'cashback_history',
        entityId: fullReceipt.documentId,
      });
    }
  }

  if (result?.countsForScanTask) {
    await updateScanFirstReceiptsTaskProgress(
      userId,
      fullReceipt.id || fullReceipt.documentId
    );
  }

  await updateUserBalance(userId);
  return userId;
}