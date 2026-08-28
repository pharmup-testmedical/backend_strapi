import type { Core } from '@strapi/strapi';
import { createControllers } from './controllers';

const HAS_PERMISSIONS = {
  name: 'admin::hasPermissions',
  config: { actions: ['api::analytics.read'] },
};

const ROUTE_CONFIG = { policies: ['admin::isAuthenticatedAdmin', HAS_PERMISSIONS] };

/**
 * Регистрируется напрямую через strapi.server.routes({type:'admin', ...})
 * (тот же низкоуровневый механизм, что использует @strapi/upload для
 * своих ad-hoc роутов) — без отдельного Strapi-плагина. Полноценный
 * плагин потребовался бы только ради admin-UI страницы (@strapi/sdk-plugin,
 * своя сборка); для чисто backend-эндпоинтов он не нужен: strapi.server
 * .routes с type:'admin' даёт ту же admin-аутентификацию и те же policy
 * (admin::isAuthenticatedAdmin/admin::hasPermissions), что и роуты
 * настоящих плагинов — проверено по исходникам @strapi/core
 * (services/server/register-routes.js, compose-endpoint.js).
 */
export function registerAnalyticsRoutes(strapi: Core.Strapi) {
  const controllers = createControllers(strapi);

  const route = (method: 'GET', path: string, handler: any) => ({
    method,
    path,
    handler,
    config: ROUTE_CONFIG,
    info: {},
  });

  strapi.server.routes({
    type: 'admin',
    prefix: '/analytics',
    routes: [
      route('GET', '/overview', controllers.overview),
      route('GET', '/receipts-daily', controllers.receiptsDaily),
      route('GET', '/cashback-daily', controllers.cashbackDaily),
      route('GET', '/statuses', controllers.statuses),
      route('GET', '/weekday', controllers.weekday),
      route('GET', '/hourly', controllers.hourly),
      route('GET', '/cities', controllers.cities),
      route('GET', '/users', controllers.users),
      route('GET', '/users/:id', controllers.userDetail),
      route('GET', '/users/:id/daily', controllers.userDaily),
      route('GET', '/users/:id/cities', controllers.userCities),
      route('GET', '/users/:id/receipts', controllers.userReceipts),
      route('GET', '/products', controllers.products),
      route('GET', '/groups', controllers.groups),
      route('GET', '/categories', controllers.categories),
      route('GET', '/suppliers', controllers.suppliers),
      route('GET', '/ofd', controllers.ofd),
      route('GET', '/compare', controllers.compare),
      route('GET', '/platforms', controllers.platforms),
      route('GET', '/demographics', controllers.demographics),
      route('GET', '/app-versions', controllers.appVersions),
      route('GET', '/app-versions/trend', controllers.appVersionsTrend),
      route('GET', '/meta/cities', controllers.metaCities),
    ],
  });
}
