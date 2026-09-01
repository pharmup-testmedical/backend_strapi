import type { Core } from '@strapi/strapi';
import { createControllers } from './controllers';

const HAS_PERMISSIONS = {
  name: 'admin::hasPermissions',
  config: { actions: ['api::user-verification.read'] },
};

const ROUTE_CONFIG = { policies: ['admin::isAuthenticatedAdmin', HAS_PERMISSIONS] };

// Тот же низкоуровневый механизм регистрации, что уже используется для
// /analytics/* (src/analytics/routes.ts) — strapi.server.routes с
// type:'admin' даёт ту же admin-аутентификацию и те же policy, что и роуты
// настоящих Strapi-плагинов, без необходимости оформлять отдельный плагин.
export function registerUserVerificationRoutes(strapi: Core.Strapi) {
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
    prefix: '/user-verification',
    routes: [
      route('GET', '/search', controllers.search),
      route('GET', '/:userId/summary', controllers.summary),
      route('GET', '/:userId/receipts', controllers.receipts),
      route('GET', '/:userId/receipts/:receiptId', controllers.receiptDetail),
      route('GET', '/:userId/transactions', controllers.transactions),
    ],
  });
}
