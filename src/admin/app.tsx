import type { StrapiApp } from '@strapi/strapi/admin';
import { ChartCircle, Shield } from '@strapi/icons';

export default {
  config: {
    locales: [
      // 'ar',
      // 'fr',
      // 'cs',
      'de',
      // 'dk',
      // 'es',
      // 'he',
      // 'id',
      // 'it',
      // 'ja',
      // 'ko',
      // 'ms',
      // 'nl',
      // 'no',
      // 'pl',
      // 'pt-BR',
      // 'pt',
      'ru',
      // 'sk',
      // 'sv',
      // 'th',
      // 'tr',
      // 'uk',
      // 'vi',
      // 'zh-Hans',
      // 'zh',
    ],
  },
  bootstrap(app: StrapiApp) {
    console.log(app);
  },
  // register(app), не bootstrap(app) — в Strapi 5.13.0 bootstrap получает
  // урезанный объект без app.router, addMenuLink здесь тоже доступен, но
  // держим всю кастомную регистрацию в одном месте с гарантированно полным
  // API (проверено по исходникам @strapi/admin/dist/admin/admin/src/StrapiApp.js).
  register(app: StrapiApp) {
    app.addMenuLink({
      to: 'analytics',
      icon: ChartCircle,
      intlLabel: {
        id: 'pharmup-analytics.nav-label',
        defaultMessage: 'Аналитика',
      },
      permissions: [{ action: 'api::analytics.read', subject: null }],
      Component: () => import('./pages/analytics'),
    });

    app.addMenuLink({
      to: 'user-verification',
      icon: Shield,
      intlLabel: {
        id: 'pharmup-user-verification.nav-label',
        defaultMessage: 'Проверка пользователя',
      },
      permissions: [{ action: 'api::user-verification.read', subject: null }],
      Component: () => import('./pages/user-verification'),
    });
  },
};
