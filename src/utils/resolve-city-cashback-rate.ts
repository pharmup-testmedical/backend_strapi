import type { Core } from '@strapi/strapi';

/**
 * Городские особенности ставки кешбэка (api::product-city-override).
 *
 * Принцип: если для пары (товар, город) нет записи — действует стандартная
 * ставка карточки товара, товар виден везде. Это специально сделано
 * аддитивным — без единой строки override поведение каталога и начисления
 * кешбэка не меняется ни для одного города (тот же принцип, что уже
 * применялся для ProductSupplier/ProductCashbackHistory).
 *
 * Авторитетный город — ВСЕГДА user.city (город из профиля), одинаково и для
 * каталога (что показываем), и для начисления кешбэка (что реально платим) —
 * чтобы пользователь никогда не видел одну сумму, а получал другую.
 * receipt.organizationCity (фактический город точки продажи) для этого
 * намеренно не используется — он остаётся только для аналитики.
 */

export interface CityRateOverride {
  cashbackAmount: number | null;
  visible: boolean;
}

export async function getUserCityId(strapi: Core.Strapi, userId: number): Promise<number | null> {
  const user = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: { id: userId },
    populate: { city: { select: ['id'] } },
  });
  return (user as any)?.city?.id ?? null;
}

export async function fetchCityCashbackOverrides(
  strapi: Core.Strapi,
  productIds: number[],
  cityId: number | null
): Promise<Map<number, CityRateOverride>> {
  const map = new Map<number, CityRateOverride>();
  if (!cityId || productIds.length === 0) return map;

  const rows = (await strapi.db.query('api::product-city-override.product-city-override').findMany({
    where: { product: { id: { $in: productIds } }, city: cityId },
    select: ['cashbackAmount', 'visible'],
    populate: { product: { select: ['id'] } },
  })) as Array<{ cashbackAmount: number | null; visible: boolean; product: { id: number } | null }>;

  for (const row of rows) {
    const productId = row.product?.id;
    if (productId == null) continue;
    map.set(productId, {
      cashbackAmount: row.cashbackAmount == null ? null : Number(row.cashbackAmount),
      visible: row.visible !== false,
    });
  }

  return map;
}

// override.cashbackAmount===null значит «ставка не переопределена, изменена
// только видимость» — тогда действует базовая ставка карточки товара.
export function resolveEffectiveCashbackAmount(
  baseCashbackAmount: number,
  productId: number,
  overrides: Map<number, CityRateOverride>
): number {
  const override = overrides.get(productId);
  if (!override || override.cashbackAmount == null) return baseCashbackAmount;
  return override.cashbackAmount;
}
