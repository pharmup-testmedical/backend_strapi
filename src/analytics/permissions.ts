import type { Core } from '@strapi/strapi';

/**
 * Единое право на просмотр раздела «Аналитика» в Admin Panel. На этапе 1
 * эндпоинтов ещё нет UI-разбивки по блокам, поэтому одно право на всё —
 * при необходимости более гранулярного контроля (например, отдельно
 * пользовательская аналитика) можно расширить на следующих этапах.
 *
 * section: 'plugins' потребовал бы, чтобы 'analytics' было именем реально
 * зарегистрированного Strapi-плагина (проверяется в
 * @strapi/admin/.../validation/common-validators.js: isAPluginName) — а
 * бэкенд этого этапа сознательно НЕ оформлен как отдельный плагин (см.
 * routes.ts). Поэтому используем section: 'settings' без pluginName —
 * итоговый action id получается 'api::analytics.read'.
 */
export const ANALYTICS_ACTIONS = [
  {
    section: 'settings' as const,
    category: 'Аналитика',
    displayName: 'Просмотр раздела Аналитика',
    uid: 'analytics.read',
  },
];

export async function registerAnalyticsPermissions(strapi: Core.Strapi) {
  await strapi.service('admin::permission').actionProvider.registerMany(ANALYTICS_ACTIONS);
}
