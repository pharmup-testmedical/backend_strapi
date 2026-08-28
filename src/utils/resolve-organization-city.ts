import type { Core } from '@strapi/strapi';
import { deriveCityAndAddress } from './kz-city-clusters';

export interface ResolvedOrganizationCity {
  organizationCity: string | null; // documentId api::city.city, либо null
  citySource: 'organization' | 'unknown';
}

/**
 * Определяет город точки продажи из organizationAddress чека, переиспользуя
 * существующий deriveCityAndAddress() (тот же парсер, что уже используется
 * для выгрузки в Google Таблицу) и существующий справочник api::city.city —
 * никакого нового парсера/справочника. citySource='user' сюда не попадает
 * никогда — это зарезервированное для будущего значение, здесь принципиально
 * не используется текущий город пользователя (см. Receipt.organizationCity
 * в schema.json).
 */
export async function resolveOrganizationCity(
  strapi: Core.Strapi,
  organizationAddress: string | null | undefined
): Promise<ResolvedOrganizationCity> {
  const { city } = deriveCityAndAddress(organizationAddress);

  if (!city) {
    return { organizationCity: null, citySource: 'unknown' };
  }

  const cityEntry = await strapi.documents('api::city.city').findFirst({
    filters: { name: city },
  });

  if (!cityEntry) {
    strapi.log.warn(
      `[organizationCity] Город "${city}" распознан из адреса, но отсутствует в справочнике api::city.city`
    );
    return { organizationCity: null, citySource: 'unknown' };
  }

  return { organizationCity: cityEntry.documentId, citySource: 'organization' };
}
