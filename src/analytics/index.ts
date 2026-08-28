import type { Core } from '@strapi/strapi';
import { registerAnalyticsPermissions } from './permissions';
import { registerAnalyticsRoutes } from './routes';
import { ensureAnalyticsIndexes } from './indexes';

export async function registerAnalytics({ strapi }: { strapi: Core.Strapi }) {
  await registerAnalyticsPermissions(strapi);
  registerAnalyticsRoutes(strapi);
  await ensureAnalyticsIndexes(strapi);
  strapi.log.info('[analytics] Раздел «Аналитика» зарегистрирован (backend, этап 1)');
}
