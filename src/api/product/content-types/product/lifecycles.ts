/**
 * Автоматическая история ставки кешбэка товара (api::product-cashback-history).
 *
 * Нужна, чтобы «Проверка пользователя» (src/user-verification) могла отличать
 * легитимное историческое изменение Product.cashbackAmount от реальной ошибки
 * ввода ставки на чеке — раньше при любом изменении ставки все старые чеки
 * с прежней (тогда правильной) ставкой начинали ложно попадать в список
 * расхождений.
 *
 * При каждом изменении cashbackAmount закрывает текущий открытый период
 * (validTo = сейчас) и открывает новый (validFrom = сейчас) — начиная с
 * этого коммита история пишется сама, без ручной работы админа. Если для
 * товара это первое изменение с тех пор, как появилась эта история (открытого
 * периода ещё нет), задним числом создаёт запись для старой ставки — с
 * validFrom = null (действовала с неизвестного момента, это честно: точную
 * дату предыдущего изменения мы не знаем).
 */

const EPSILON = 0.01;

async function recordRateChange(productId: number, oldRate: number, newRate: number) {
  if (!Number.isFinite(oldRate) || !Number.isFinite(newRate)) return;
  if (Math.abs(oldRate - newRate) < EPSILON) return;

  const now = new Date();
  const historyQuery = strapi.db.query('api::product-cashback-history.product-cashback-history');

  const openPeriod = await historyQuery.findOne({
    where: { product: productId, validTo: null },
  });

  if (openPeriod) {
    await historyQuery.update({ where: { id: openPeriod.id }, data: { validTo: now } });
  } else {
    await historyQuery.create({
      data: { product: productId, rate: oldRate, validFrom: null, validTo: now },
    });
  }

  await historyQuery.create({
    data: { product: productId, rate: newRate, validFrom: now, validTo: null },
  });
}

export default {
  async beforeUpdate(event: any) {
    const { params, state } = event;
    const { data, where } = params || {};

    if (data?.cashbackAmount === undefined) return;

    // Fail-open: если не удаётся определить текущую ставку — просто не
    // пишем историю для этого сохранения, но и не блокируем его (история
    // кешбэка — вспомогательные данные для сверки, а не критичная логика
    // начисления, ронять сохранение товара из-за неё нельзя).
    const id = where?.id;
    if (id === undefined) return;

    const existing = await strapi.db.query('api::product.product').findOne({
      where: { id },
      select: ['id', 'cashbackAmount'],
    });
    if (!existing) return;

    state.previousCashbackAmount = Number(existing.cashbackAmount);
    state.productId = existing.id;
  },

  async afterUpdate(event: any) {
    const { state, result } = event;
    if (state?.previousCashbackAmount === undefined || state?.productId === undefined) return;
    if (result?.cashbackAmount === undefined || result?.cashbackAmount === null) return;

    try {
      await recordRateChange(state.productId, state.previousCashbackAmount, Number(result.cashbackAmount));
    } catch (error: any) {
      strapi.log.error(`[product-cashback-history] Не удалось записать смену ставки для товара ${state.productId}: ${error.message}`);
    }
  },
};
