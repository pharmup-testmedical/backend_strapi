import { verifiedStatuses } from '../../../../utils/update-scan-task-progress/verified-statuses';
import { updateUserBalance } from '../../../../utils/calculate-user-balance';
import { checkReferralInvitationTask } from '../../../../utils/check-referral-invitation-task';
import { updateScanFirstReceiptsTaskProgress } from '../../../../utils/update-scan-task-progress';
import { createNotification } from '../../../../utils/create-notification';
import { formatCurrency } from '../../../../utils/format-currency';
import { reconcileReceiptDepositsSafely, releaseReceiptItemDepositsSafely, DepositRelease } from '../../../../utils/reconcile-receipt-deposits';

export default {
  async afterCreate(event: any) {
    const { result } = event;
    // Сверка депозитов сюда НЕ входит — она сознательно вынесена из
    // транзакции create() в отдельный вызов reconcileReceiptDepositsSafely,
    // выполняемый вызывающим кодом (receipt/controllers/receipt.ts) СРАЗУ
    // ПОСЛЕ того, как create() уже вернул результат и транзакция чека
    // закоммичена — см. подробный разбор архитектуры и причину (MySQL-
    // дедлок ронял бы весь чек) в шапке reconcile-receipt-deposits.ts.
    // Поэтому здесь handleReceiptLifecycle (и его пересчёт баланса) может
    // отработать по чуть более старым cashback-значениям позиций, если
    // среди них есть которые сверка обнулит из-за исчерпания депозита —
    // это не потеря: reconcileReceiptDepositsSafely после себя тоже
    // вызывает updateUserBalance (см. controllers/receipt.ts), так что
    // баланс пользователя досчитывается вторым проходом сразу следом.
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

  // ВАЖНО (этап 2, подэтап 4 — возвраты): в отличие от afterCreate, сверка
  // депозита здесь ОСТАЁТСЯ внутри хука (не вынесена в контроллер) —
  // сознательно, не по недосмотру. Обновления чека приходят из мест, которые
  // не мои контроллеры (админка Content Manager — свой внутренний API
  // плагина; determine-receipt-status.ts при подтверждении/отклонении
  // псевдонима — вызывается из product-alias'а, не из receipt'а), поэтому
  // "вынести в контроллер, как при создании" здесь физически некуда — этот
  // хук единственное место, которое видит все пути одинаково. Риск
  // тот же (дедлок внутри транзакции update() уронит весь update), но
  // профиль другой: это редкое админское действие с дешёвым повтором
  // (просто нажать «Сохранить» ещё раз), не непрерывный живой трафик
  // пользователей, как создание чека. Проверено параллельной нагрузкой на
  // MySQL — см. отчёт в памяти проекта/коммите.
  async afterUpdate(event: any) {
    const { result } = event;
    await reconcileReceiptDepositsSafely(strapi, result.id);

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
  //
  // Депозит (подэтап 4, сценарий «удалили чек») — тот же принцип: после
  // DELETE строки чека уже нет, reconcileReceiptDeposits ничего не найдёт и
  // тихо не сделает ничего, а списанное зависнет в депозите навсегда. Пока
  // строка ЕЩЁ жива, захватываем по каждой позиции fundingSupplier +
  // ФАКТИЧЕСКИ списанное depositDeductedAmount — afterDelete затем вернёт
  // ровно эти суммы через releaseReceiptItemDepositsSafely.
  //
  // ВАЖНО (найдено эмпирически на MySQL, подэтап 4 — два конкурентных
  // delete() ОДНОГО и того же documentId): строки components_receipt_item_items
  // удаляются СИНХРОННО вместе с чеком, ничего не переживает до afterDelete
  // (проверено отдельным скриптом) — значит afterDelete физически не может
  // сам определить, что его вызвали второй раз. Простое «прочитать и
  // возвращать» здесь classic TOCTOU: два одновременных beforeDelete оба
  // читают ОДНО и то же depositDeductedAmount ДО того, как что-либо
  // удалено, оба кладут его в свой event.state, оба afterDelete возвращают
  // — задвоенный возврат (подтверждено тестом: 1300 вместо 1000).
  //
  // Фикс — atomic CLAIM здесь же, в beforeDelete, тем же приёмом, что и
  // атомарное списание в reconcileReceiptDeposits (условный UPDATE вместо
  // «прочитать, потом решить»): `WHERE deposit_deducted_amount = <то, что
  // только что прочитали>` — если конкурентный beforeDelete успел обнулить
  // поле первым, наш UPDATE найдёт 0 строк и мы НЕ включаем эту позицию в
  // depositReleases (проиграли claim, ничего не возвращаем — уже вернёт
  // победитель). Выполняется через strapi.db.transaction() (участвует в той
  // же транзакции delete(), как и everywhere в этом файле после подэтапа
  // 2/4) — если delete() позже всё же упадёт по не связанной с этим причине,
  // claim откатится вместе с ним, депозит не потеряет запись о списании
  // навсегда.
  async beforeDelete(event: any) {
    const { where } = event.params;
    const record = await strapi.db.query('api::receipt.receipt').findOne({
      where,
      populate: {
        user: true,
        items: {
          on: {
            'receipt-item.item': {
              populate: { fundingSupplier: { fields: ['id'] } },
            },
          },
        },
      },
    });

    const candidates: { itemId: number; supplierId: number; amount: number }[] = (record?.items ?? [])
      .filter((it: any) => it.__component === 'receipt-item.item' && it.fundingSupplier?.id != null)
      .map((it: any) => ({ itemId: it.id, supplierId: it.fundingSupplier.id, amount: Number(it.depositDeductedAmount) || 0 }))
      .filter((c: any) => c.amount > 0);

    const depositReleases: DepositRelease[] = [];
    if (candidates.length > 0) {
      await strapi.db.transaction(async ({ trx }: { trx: any }) => {
        const knex = strapi.db.connection;
        for (const candidate of candidates) {
          const affected = await knex('components_receipt_item_items')
            .transacting(trx)
            .where('id', candidate.itemId)
            .where('deposit_deducted_amount', candidate.amount)
            .update({ deposit_deducted_amount: 0 });
          // affected>0 — мы выиграли claim, эта сумма наша, возвращаем её.
          // affected===0 — кто-то другой уже обнулил поле первым (конкурентный
          // delete того же чека), возврат не наш, пропускаем.
          if (affected > 0) {
            depositReleases.push({ supplierId: candidate.supplierId, amount: candidate.amount });
          }
        }
      });
    }

    event.state = { userDocumentId: record?.user?.documentId, depositReleases };
  },

  async afterDelete(event: any) {
    const depositReleases: DepositRelease[] = event.state?.depositReleases ?? [];
    if (depositReleases.length > 0) {
      await releaseReceiptItemDepositsSafely(strapi, depositReleases);
    }

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