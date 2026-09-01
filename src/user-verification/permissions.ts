import type { Core } from '@strapi/strapi';

/**
 * Отдельное право (не переиспользует api::analytics.read) — это финансовый
 * аудит-инструмент для реальных решений по выплатам, а не BI-дашборд;
 * аудитория ролей у них разная. section: 'settings' без pluginName — по
 * тем же причинам, что и в src/analytics/permissions.ts (раздел не оформлен
 * как отдельный Strapi-плагин).
 */
export const USER_VERIFICATION_ACTIONS = [
  {
    section: 'settings' as const,
    category: 'Проверка пользователя',
    displayName: 'Просмотр раздела «Проверка пользователя»',
    uid: 'user-verification.read',
  },
];

export async function registerUserVerificationPermissions(strapi: Core.Strapi) {
  await strapi.service('admin::permission').actionProvider.registerMany(USER_VERIFICATION_ACTIONS);
}
