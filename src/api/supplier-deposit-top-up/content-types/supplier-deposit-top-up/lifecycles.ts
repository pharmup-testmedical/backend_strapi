/**
 * Пополнение депозита — бухгалтерская запись, а не редактируемое поле:
 * amount/deposit нельзя менять после создания (для исправления ошибки —
 * удалить запись и создать новую, тогда баланс скорректируется симметрично
 * через afterCreate/afterDelete ниже). Это НЕ про начисление кешбэка при
 * чеке (та логика — отдельный будущий этап) — только про ручное пополнение
 * депозита администратором.
 */

const extractDepositId = (data: any): number | string | undefined => {
  const deposit = data?.deposit;
  if (deposit == null) return undefined;
  if (typeof deposit === 'number' || typeof deposit === 'string') return deposit;
  // Реальная admin-форма Content Manager шлёт {connect:[{id}]}, а не голый
  // id/documentId — тот же нюанс, что уже встречался у ProductSupplier.
  if (deposit.connect?.[0]?.id != null) return deposit.connect[0].id;
  if (deposit.set?.[0]?.id != null) return deposit.set[0].id;
  return undefined;
};

export default {
  async beforeUpdate(event: any) {
    const { data } = event.params || {};
    if (data?.amount !== undefined || extractDepositId(data) !== undefined) {
      throw new Error(
        'Пополнение депозита нельзя редактировать после создания — удалите запись и создайте новую'
      );
    }
  },

  async afterCreate(event: any) {
    const { result } = event;
    const depositId = extractDepositId(event.params?.data) ?? result?.deposit?.id ?? result?.deposit;
    const amount = Number(result?.amount);

    if (depositId == null || !Number.isFinite(amount)) {
      strapi.log.warn(
        `[SupplierDepositTopUp] Не удалось определить депозит/сумму для новой записи ${result?.documentId} — баланс не увеличен`
      );
      return;
    }

    const deposit = await strapi.db
      .query('api::supplier-cashback-deposit.supplier-cashback-deposit')
      .findOne({ where: { id: depositId }, select: ['id', 'balance'] });
    if (!deposit) return;

    await strapi.db.query('api::supplier-cashback-deposit.supplier-cashback-deposit').update({
      where: { id: deposit.id },
      data: { balance: Number(deposit.balance) + amount, lowBalanceNotifiedAt: null },
    });

    strapi.log.info(
      `[SupplierDepositTopUp] Депозит ${deposit.id} пополнен на ${amount} — новый баланс ${Number(deposit.balance) + amount}`
    );
  },

  // Запись удаляется до срабатывания afterDelete — депозит и сумму нужно
  // запомнить заранее (тот же паттерн, что уже используется для
  // cashback-request.beforeDelete).
  async beforeDelete(event: any) {
    const { where } = event.params;
    const record = await strapi.db.query('api::supplier-deposit-top-up.supplier-deposit-top-up').findOne({
      where,
      select: ['id', 'amount'],
      populate: { deposit: { select: ['id'] } },
    });
    event.state = { depositId: record?.deposit?.id, amount: Number(record?.amount) };
  },

  async afterDelete(event: any) {
    const { depositId, amount } = event.state || {};
    if (depositId == null || !Number.isFinite(amount)) return;

    const deposit = await strapi.db
      .query('api::supplier-cashback-deposit.supplier-cashback-deposit')
      .findOne({ where: { id: depositId }, select: ['id', 'balance'] });
    if (!deposit) return;

    await strapi.db.query('api::supplier-cashback-deposit.supplier-cashback-deposit').update({
      where: { id: deposit.id },
      data: { balance: Number(deposit.balance) - amount },
    });

    strapi.log.info(
      `[SupplierDepositTopUp] Пополнение отменено (удалена запись) — депозит ${deposit.id} уменьшен на ${amount}`
    );
  },
};
